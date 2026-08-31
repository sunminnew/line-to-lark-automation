/**
 * server.js — LINE → วิสดอม AI → Lark
 *
 * FIX 2026-07-27:
 *   - replyMessages now re-throws (see lineHandler.js) → push fallback fires
 *   - push fallback now logs success/failure for diagnosis
 */
require('dotenv').config();
const express = require('express');
const axios = require('axios');
const { isBusinessHours, getBangkokTime } = require('./timeRouter');
const { isWorkingDay } = require('./holidays');
const { addMessage, flushMessages } = require('./messageStore');
const {
  verifySignature, translateAll, replyMessages, getSenderName,
} = require('./lineHandler');
const { startCronJob, runPipeline } = require('./cronJob');
const { startKeepAlive } = require('./keepAlive');
const { summarizeForLark } = require('./aiSummarizer');
const { sendToLarkGroup, sendSummaryCard, sendAlertCard } = require('./larkMessenger');
const { recordActivity, addOffHoursMessage, consumeHolidayReminder } = require('./messageTracker');
const { isQuestion, answerAIUrgent, analyzeForLark } = require('./smartAdvisor');


// ── Live Log Broadcaster (SSE) ────────────────────────────────────────────────
const _lc = new Set();
const _lb = [];
function _bcast(level, msg) {
  const e = { t: new Date().toISOString(), l: level, m: String(msg) };
  _lb.push(e); if (_lb.length > 300) _lb.shift();
  const d = 'data: ' + JSON.stringify(e) + '\n\n';
  for (const c of _lc) { try { c.write(d); } catch (_) { _lc.delete(c); } }
}
const _cl = console.log, _cw = console.warn, _ce = console.error;
console.log   = (...a) => { _cl(...a);  _bcast('info',  a.join(' ')); };
console.warn  = (...a) => { _cw(...a);  _bcast('warn',  a.join(' ')); };
console.error = (...a) => { _ce(...a);  _bcast('error', a.join(' ')); };

const LOGS_HTML = `<!DOCTYPE html><html lang="th"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>WISDOM // SYSMON</title><style>
:root{--g:#00ff88;--b:#00cfff;--r:#ff3860;--y:#ffdd57;--p:#bb88ff;--bg:#090910;--panel:#0d0d18;--dim:#111120;--border:#1a1a2e;--txt:#8080a0}
*{margin:0;padding:0;box-sizing:border-box}
body{background:var(--bg);color:var(--txt);font-family:'Courier New',monospace;font-size:13px;height:100vh;display:flex;flex-direction:column;overflow:hidden}
.topbar{background:var(--panel);border-bottom:1px solid var(--border);padding:8px 14px;display:flex;align-items:center;gap:10px}
.logo{font-size:13px;color:var(--g);letter-spacing:4px;font-weight:bold;text-shadow:0 0 12px var(--g)}
.badge{font-size:9px;color:#2a2a4a;border:1px solid #1a1a2e;padding:1px 6px;border-radius:2px;letter-spacing:1px}
.blink{width:8px;height:8px;border-radius:50%;background:var(--g);box-shadow:0 0 10px var(--g);animation:bl 1.2s infinite;flex-shrink:0}
@keyframes bl{0%,100%{opacity:1}50%{opacity:.15}}
.uptime{margin-left:auto;font-size:10px;color:#2a2a4a;letter-spacing:1px}
.stats{display:grid;grid-template-columns:repeat(6,1fr);gap:6px;padding:8px 12px;background:var(--panel);border-bottom:1px solid var(--border)}
.sc{background:var(--dim);border:1px solid var(--border);border-radius:3px;padding:6px 10px;position:relative;overflow:hidden}
.sc::before{content:'';position:absolute;top:0;left:0;right:0;height:2px}
.sc.g::before{background:var(--g);box-shadow:0 0 8px var(--g)}.sc.b::before{background:var(--b)}.sc.r::before{background:var(--r)}.sc.y::before{background:var(--y)}.sc.p::before{background:var(--p)}
.sc-label{font-size:8px;color:#2a2a4a;letter-spacing:1px;text-transform:uppercase}
.sc-val{font-size:22px;font-weight:bold;margin-top:2px;letter-spacing:1px}
.sc-sub{font-size:9px;color:#222;margin-top:1px}
.g .sc-val{color:var(--g);text-shadow:0 0 10px var(--g)}.b .sc-val{color:var(--b);text-shadow:0 0 8px var(--b)}.r .sc-val{color:var(--r);text-shadow:0 0 8px var(--r)}.y .sc-val{color:var(--y)}.p .sc-val{color:var(--p)}.d .sc-val{color:#2a2a5a}
.svcs{display:flex;gap:14px;padding:5px 14px;background:var(--dim);border-bottom:1px solid var(--border);font-size:10px;align-items:center}
.svc{display:flex;align-items:center;gap:5px}
.dot{width:7px;height:7px;border-radius:50%;flex-shrink:0;transition:all .3s}
.dot.ok{background:var(--g);box-shadow:0 0 6px var(--g)}.dot.warn{background:var(--y)}.dot.err{background:var(--r)}.dot.off{background:#1a1a2e}
.svc-n{color:#333;letter-spacing:.5px}.svc-v{color:#555;margin-left:2px}
.sparkwrap{background:var(--panel);border-bottom:1px solid var(--border);padding:5px 14px;display:flex;align-items:flex-end;gap:2px;height:40px}
.sp-lbl{font-size:8px;color:#1e1e2e;letter-spacing:1px;white-space:nowrap;align-self:center;margin-right:6px}
.bar{width:7px;border-radius:1px 1px 0 0;min-height:2px;transition:height .4s;opacity:.65;flex-shrink:0}
.bar.ok{background:var(--g)}.bar.er{background:var(--r)}
.fbar{background:var(--panel);border-bottom:1px solid var(--border);padding:4px 12px;display:flex;gap:5px;align-items:center}
.fl{font-size:9px;color:#222;letter-spacing:1px;margin-right:2px}
.fb{background:none;border:1px solid var(--border);color:#2a2a4a;padding:2px 9px;border-radius:2px;cursor:pointer;font-family:'Courier New',monospace;font-size:10px;letter-spacing:1px;transition:all .15s}
.fb:hover{border-color:#333;color:#555}.fb.on{border-color:var(--g);color:var(--g);text-shadow:0 0 6px var(--g);background:#001408}
.srch{margin-left:auto;background:var(--dim);border:1px solid var(--border);color:var(--txt);padding:2px 8px;border-radius:2px;font-family:'Courier New',monospace;font-size:11px;width:180px;outline:none}
.srch:focus{border-color:var(--b);box-shadow:0 0 6px rgba(0,207,255,.2)}
#lp{flex:1;overflow-y:auto;scrollbar-width:thin;scrollbar-color:var(--border) var(--bg)}
.row{display:flex;gap:8px;padding:1px 12px;border-bottom:1px solid #0c0c16;font-size:11.5px;line-height:1.7;transition:background .1s}
.row:hover{background:#0f0f1a}.row.new{animation:fl .5s}
@keyframes fl{from{background:#002214}to{background:transparent}}
.ts{color:#1a1a30;min-width:80px;flex-shrink:0;font-size:10px;padding-top:1px}
.lv{font-size:9px;min-width:36px;text-align:center;padding:0 3px;border-radius:2px;flex-shrink:0;align-self:flex-start;margin-top:3px;letter-spacing:.5px}
.lv.I{background:#0a180a;color:#1e4a1e;border:1px solid #163216}.lv.W{background:#181800;color:#4a4410;border:1px solid #2e2c00}.lv.E{background:#180a0a;color:#5a1010;border:1px solid #2e0e0e}
.m{flex:1;word-break:break-all}.m.ok{color:var(--g)}.m.warn{color:var(--y)}.m.err{color:var(--r);font-weight:bold}.m.tr{color:var(--b)}.m.cache{color:var(--p)}.m.sys{color:#252540}
footer{background:var(--panel);border-top:1px solid var(--border);padding:4px 14px;font-size:9px;color:#1e1e30;display:flex;justify-content:space-between;align-items:center;letter-spacing:.5px}
footer label{display:flex;align-items:center;gap:4px;cursor:pointer;color:#2a2a4a}
input[type=checkbox]{accent-color:var(--g)}
</style></head><body>
<div class="topbar"><div class="blink" id="led"></div><div class="logo">WISDOM // SYSMON</div><div class="badge">LINE BOT</div><div class="badge">RENDER FREE</div><div class="uptime">UP <span id="upt">00:00:00</span></div></div>
<div class="stats">
<div class="sc g"><div class="sc-label">TRANSLATED</div><div class="sc-val" id="s-ok">0</div><div class="sc-sub">success total</div></div>
<div class="sc b"><div class="sc-label">RATE / MIN</div><div class="sc-val" id="s-rpm">0.0</div><div class="sc-sub">last 60s</div></div>
<div class="sc r"><div class="sc-label">ERRORS</div><div class="sc-val" id="s-err">0</div><div class="sc-sub">all time</div></div>
<div class="sc y"><div class="sc-label">MESSAGES IN</div><div class="sc-val" id="s-msg">0</div><div class="sc-sub">received</div></div>
<div class="sc p"><div class="sc-label">SUCCESS %</div><div class="sc-val" id="s-pct">—</div><div class="sc-sub">accuracy</div></div>
<div class="sc d"><div class="sc-label">LOG ROWS</div><div class="sc-val" id="s-cnt">0</div><div class="sc-sub">in panel</div></div>
</div>
<div class="svcs"><span style="font-size:8px;color:#1e1e2e;letter-spacing:1px;margin-right:6px">SERVICES //</span>
<div class="svc"><div class="dot off" id="d-gm"></div><span class="svc-n">GEMINI</span><span class="svc-v" id="v-gm">—</span></div>
<div class="svc"><div class="dot off" id="d-g1"></div><span class="svc-n">GROQ-120B</span><span class="svc-v" id="v-g1">—</span></div>
<div class="svc"><div class="dot off" id="d-g2"></div><span class="svc-n">GROQ-20B</span><span class="svc-v" id="v-g2">—</span></div>
<div class="svc" style="margin-left:auto"><div class="dot ok" id="d-ss"></div><span class="svc-n">SSE STREAM</span></div></div>
<div class="sparkwrap"><span class="sp-lbl">ACTIVITY // 60s</span><div id="spk"></div></div>
<div class="fbar"><span class="fl">FILTER //</span>
<button class="fb on" onclick="setF('all',this)">ALL</button>
<button class="fb" onclick="setF('tr',this)">TRANSLATE</button>
<button class="fb" onclick="setF('err',this)">ERRORS</button>
<button class="fb" onclick="setF('line',this)">LINE API</button>
<input class="srch" id="sq" placeholder="search logs..." oninput="applyFilter()"></div>
<div id="lp"></div>
<footer><span id="fc">0 entries</span><span id="fm" style="color:#1e1e3a">model: —</span><label><input type="checkbox" id="asc" checked> AUTOSCROLL</label></footer>
<script>
var all=[],filt='all',cOk=0,cErr=0,cMsg=0,t0=Date.now(),gemCd=0,recentOk=[];
var lp=document.getElementById('lp'),asc=document.getElementById('asc');
var spk=document.getElementById('spk');
var sk60=new Array(60).fill(0);
for(var i=0;i<60;i++){var b=document.createElement('div');b.className='bar ok';b.style.height='2px';spk.appendChild(b);}
function pad(n){return String(n).padStart(2,'0');}
setInterval(function(){
  var s=Math.floor((Date.now()-t0)/1000);
  document.getElementById('upt').textContent=pad(Math.floor(s/3600))+':'+pad(Math.floor(s%3600/60))+':'+pad(s%60);
  recentOk=recentOk.filter(function(x){return Date.now()-x<60000;});
  document.getElementById('s-rpm').textContent=recentOk.length.toFixed(1);
  if(gemCd>Date.now()){
    var r=Math.ceil((gemCd-Date.now())/1000);
    document.getElementById('d-gm').className='dot warn';
    document.getElementById('v-gm').textContent='CD '+r+'s';
  }else if(gemCd>0){
    document.getElementById('d-gm').className='dot ok';
    document.getElementById('v-gm').textContent='READY';
    gemCd=0;
  }
},1000);
function updSpark(isErr){
  var now=Math.floor(Date.now()/1000),idx=now%60;
  sk60[idx]=(sk60[idx]||0)+1;
  var max=Math.max.apply(null,sk60)||1,bars=spk.children;
  for(var i=0;i<60;i++){
    var age=(now-i+3600)%60,bIdx=(idx-age+60)%60;
    var bar=bars[60-1-age];
    if(bar){bar.style.height=Math.max(2,Math.round(sk60[bIdx]/max*28))+'px';bar.className=isErr?'bar er':'bar ok';}
  }
}
function cls(m){
  if(/[TR].*ok/i.test(m)||/Reply ok|Gemini ok|Groq ok|Cache hit|Azure ok/i.test(m)) return 'ok';
  if(/error|failed|exhausted/i.test(m)) return 'err';
  if(/429|cooldown|trying next|unavailable/i.test(m)) return 'warn';
  if(/[TR]|[Translate]/i.test(m)) return 'tr';
  return 'sys';
}
function show(e){
  var m=e.m,sq=(document.getElementById('sq').value||'').toLowerCase();
  if(sq&&m.toLowerCase().indexOf(sq)===-1) return false;
  if(filt==='tr') return /[TR]|[Translate]|[LINE]/i.test(m);
  if(filt==='err') return /error|failed|exhausted|429/i.test(m);
  if(filt==='line') return /[LINE]/i.test(m);
  return true;
}
function setF(f,btn){filt=f;document.querySelectorAll('.fb').forEach(function(b){b.classList.remove('on');});btn.classList.add('on');applyFilter();}
function applyFilter(){lp.innerHTML='';for(var i=0;i<all.length;i++){if(show(all[i]))addRow(all[i],false);}updC();}
function addRow(e,isNew){
  if(!show(e)) return;
  var c=cls(e.m),lv=e.l==='error'?'E':e.l==='warn'?'W':'I';
  var d=document.createElement('div');
  d.className='row'+(isNew?' new':'');
  d.innerHTML='<span class="ts">'+e.t.slice(11,19)+'</span><span class="lv '+lv+'">'+lv+'OG</span><span class="m '+c+'">'+e.m.replace(/&/g,'&amp;').replace(/</g,'&lt;')+'</span>';
  lp.appendChild(d);
  if(lp.children.length>600) lp.removeChild(lp.firstChild);
  if(asc.checked) lp.scrollTop=lp.scrollHeight;
}
function updC(){document.getElementById('s-cnt').textContent=lp.children.length;document.getElementById('fc').textContent=lp.children.length+' / '+all.length+' entries';}
function proc(e){
  all.push(e);var m=e.m;
  if(/[TR].*ok/i.test(m)){cOk++;document.getElementById('s-ok').textContent=cOk;recentOk.push(Date.now());updSpark(false);}
  if(/Store.*message/i.test(m)){cMsg++;document.getElementById('s-msg').textContent=cMsg;}
  if(/error|failed|exhausted/i.test(m)&&!/KeepAlive|LarkMsg|TOKEN/i.test(m)){cErr++;document.getElementById('s-err').textContent=cErr;updSpark(true);}
  var tot=cOk+cErr;if(tot>0)document.getElementById('s-pct').textContent=Math.round(cOk/tot*100)+'%';
  if(/Groq ok.*120b/i.test(m)){document.getElementById('d-g1').className='dot ok';document.getElementById('v-g1').textContent='OK';document.getElementById('fm').textContent='model: GROQ-120B';}
  if(/Groq ok.*20b/i.test(m)){document.getElementById('d-g2').className='dot ok';document.getElementById('v-g2').textContent='OK';document.getElementById('fm').textContent='model: GROQ-20B';}
  if(/20b.*fail/i.test(m)){document.getElementById('d-g2').className='dot err';document.getElementById('v-g2').textContent='FAIL';}
  if(/Gemini ok/i.test(m)){document.getElementById('d-gm').className='dot ok';document.getElementById('v-gm').textContent='OK';document.getElementById('fm').textContent='model: GEMINI';}
  if(/cooldown (d+)s/i.test(m)){var sec=parseInt(m.match(/cooldown (d+)s/i)[1]);gemCd=Date.now()+sec*1000;}
  addRow(e,true);updC();
}
var es=new EventSource('/logs/stream');
es.onopen=function(){document.getElementById('led').style.cssText='background:var(--g);box-shadow:0 0 10px var(--g)';document.getElementById('d-ss').className='dot ok';};
es.onerror=function(){document.getElementById('led').style.cssText='background:#ff3860;box-shadow:0 0 8px #ff3860';document.getElementById('d-ss').className='dot err';};
es.onmessage=function(ev){try{proc(JSON.parse(ev.data));}catch(x){}};
</script></body></html>`;

const app = express();
const PORT = process.env.PORT ?? 3000;
const LINE_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const WEBHOOK_URL = 'https://line-to-lark-automation.onrender.com/webhook';

// ── Group name cache ──────────────────────────────────────────────────────────
const groupNameCache = new Map();
async function getGroupName(groupId) {
  if (!groupId || groupId === 'unknown') return null;
  if (groupNameCache.has(groupId)) return groupNameCache.get(groupId);
  try {
    const r = await axios.get(
      `https://api.line.me/v2/bot/group/${groupId}/summary`,
      { headers: { Authorization: `Bearer ${LINE_TOKEN}` }, timeout: 3000 }
    );
    const name = r.data.groupName || null;
    if (name) groupNameCache.set(groupId, name);
    return name;
  } catch { return null; }
}

// ── AI Urgent Sessions ────────────────────────────────────────────────────────
const aiUrgentSessions = new Map();
const AI_URGENT_TTL = 30 * 60 * 1000;

function isAIUrgentTrigger(text) {
  return /^(\/wisdom|\/w|\/위즈덤|ai\s*urgent)$/i.test(text.trim());
}
function isAIUrgentActive(groupId) {
  const exp = aiUrgentSessions.get(groupId);
  if (!exp) return false;
  if (Date.now() > exp) { aiUrgentSessions.delete(groupId); return false; }
  return true;
}
function activateAIUrgent(groupId) {
  aiUrgentSessions.set(groupId, Date.now() + AI_URGENT_TTL);
  console.log(`[AI Urgent] ✅ activated for ${groupId} (30 min)`);
}
function deactivateAIUrgent(groupId) {
  aiUrgentSessions.delete(groupId);
  console.log(`[AI Urgent] 🔕 deactivated for ${groupId}`);
}
const DEACTIVATE_WORDS = /^(ขอบคุณ|ขอบใจ|ok|โอเค|โอเค้|เสร็จแล้ว|จบแล้ว|ปิด|bye|thanks|thank you|감사|고마워)$/i;

// ── LINE 5,000-char limit guard ───────────────────────────────────────────────
const MAX_LINE_TEXT = 4900;
function toLineMessages(prefix, text) {
  const full = prefix + text;
  if (full.length <= MAX_LINE_TEXT) return [{ type: 'text', text: full }];
  const chunks = [];
  for (let i = 0; i < full.length && chunks.length < 5; i += MAX_LINE_TEXT)
    chunks.push({ type: 'text', text: full.slice(i, i + MAX_LINE_TEXT) });
  return chunks;
}

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)),
  ]);
}

// ── Debouncer: batch rapid-fire messages (500ms window) ──────────────────────
const msgBuf = new Map();
const DEBOUNCE_MS = 500;
function scheduleTranslation(sourceId, text, replyToken) {
  if (!msgBuf.has(sourceId)) msgBuf.set(sourceId, { texts: [], token: null, timer: null });
  const buf = msgBuf.get(sourceId);
  buf.texts.push(text);
  buf.token = replyToken;
  clearTimeout(buf.timer);
  buf.timer = setTimeout(async () => {
    const { texts, token } = buf;
    msgBuf.delete(sourceId);
    const combined = texts.join('\n');
    try {
      const tr = await withTimeout(translateAll(combined), 75000, 'translateAll');
      const replies = [];
      if (tr && tr.kr) replies.push(...toLineMessages('KR: ', tr.kr));
      if (tr && tr.th) replies.push(...toLineMessages('TH: ', tr.th));
      // Piggyback pending holiday reminder (free — no Push API quota)
      const holidayMsg = consumeHolidayReminder(sourceId);
      if (holidayMsg) replies.push({ type: 'text', text: holidayMsg });
      if (replies.length) {
        // replyMessages now re-throws on error → this .catch() fires on failure
        replyMessages(token, replies.slice(0, 5)).catch(async () => {
          console.log('[LINE] Reply token expired — push fallback to', sourceId);
          await axios.post('https://api.line.me/v2/bot/message/push',
            { to: sourceId, messages: replies.slice(0, 5) },
            { headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${LINE_TOKEN}` } }
          )
            .then(() => console.log('[LINE] Push ok →', sourceId))
            .catch(e => console.error('[LINE] Push failed:', e.response?.data ?? e.message));
        });
      }
    } catch (e) { console.error('[TR] silent-fail:', e.message); }
  }, DEBOUNCE_MS);
}

app.use(express.json({ verify: (req, _res, buf) => { req.rawBody = buf; } }));

const SUMMARY_KEYWORDS = ['สรุป', 'สรุปงาน', 'สรุปแชท', '/สรุป', 'summary', '/summary'];
function isSummaryRequest(text) {
  const t = text.trim().toLowerCase();
  return SUMMARY_KEYWORDS.some(k => t === k || t.startsWith(k + ' '));
}

// ── Health check ──────────────────────────────────────────────────────────────
// ── Live Log Dashboard ───────────────────────────────────────────────────────
app.get('/logs', (_req, res) => res.send(LOGS_HTML));
app.get('/logs/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.flushHeaders();
  for (const e of _lb) res.write('data: ' + JSON.stringify(e) + '\n\n');
  _lc.add(res);
  req.on('close', () => _lc.delete(res));
});

app.get('/', (_req, res) => res.json({
  status: 'ok',
  bangkokTime: getBangkokTime(),
  businessHours: isBusinessHours(),
  workingDay: isWorkingDay(new Date()),
  aiUrgentSessions: [...aiUrgentSessions.keys()],
  rooms: {
    hub: 'oc_626fd292d23700898b50fd059c1798ed',
    alert: 'oc_339458a388434ff81afde59342b511b3',
    summary: 'oc_a62e855cfd58229964b2d68b224288b8',
  },
}));

app.get('/check-webhook', async (_req, res) => {
  try {
    const r = await axios.get('https://api.line.me/v2/bot/channel/webhook/endpoint',
      { headers: { Authorization: `Bearer ${LINE_TOKEN}` } });
    res.json({ current: r.data, expected: WEBHOOK_URL, match: r.data.endpoint === WEBHOOK_URL });
  } catch (err) { res.status(500).json({ error: err.response?.data ?? err.message }); }
});

app.post('/setup-webhook', async (_req, res) => {
  try {
    const r = await axios.put('https://api.line.me/v2/bot/channel/webhook/endpoint',
      { webhookEndpointUrl: WEBHOOK_URL },
      { headers: { Authorization: `Bearer ${LINE_TOKEN}`, 'Content-Type': 'application/json' } });
    res.json({ set: WEBHOOK_URL, lineResponse: r.data });
  } catch (err) { res.status(500).json({ error: err.response?.data ?? err.message }); }
});

// LINE channel token health check
app.get('/check-line', async (_req, res) => {
  try {
    const { checkBotInfo } = require('./lineHandler');
    const result = await checkBotInfo();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/trigger', async (_req, res) => { await runPipeline(); res.json({ status: 'pipeline executed' }); });

app.get('/e2e-test', async (_req, res) => {
  try {
    const fakeMessages = [
      { timestamp: new Date().toISOString(), senderName: 'ทดสอบ', text: 'ประชุมกับลูกค้า ABC เรื่องสัญญาใหม่' },
      { timestamp: new Date().toISOString(), senderName: 'ทดสอบ', text: 'ส่งเอกสาร visa application ให้ทีม HR' },
    ];
    const summary = await summarizeForLark(fakeMessages, 'e2e-test');
    const now = new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' });
    const msgId = await sendSummaryCard(`📋 E2E Test — ${now}`, `🧪 ทดสอบระบบสำเร็จ!\n\n${summary}`);
    res.json({ success: !!msgId, msgId, room: 'summary' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── LINE Webhook ──────────────────────────────────────────────────────────────
app.post('/webhook', async (req, res) => {
  const signature = req.headers['x-line-signature'];
  if (!signature || !verifySignature(req.rawBody, signature))
    return res.status(401).json({ error: 'Invalid signature' });

  res.sendStatus(200);

  for (const event of req.body.events ?? []) {

    if (event.type === 'join') {
      const groupId = event.source?.groupId ?? event.source?.roomId ?? 'unknown';
      const now = new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' });
      console.log(`[JOIN] ${groupId}`);
      sendAlertCard('✅ วิสดอมเข้ากลุ่มใหม่',
        `🤖 **วิสดอม (위즈덤)** ถูกเพิ่มเข้ากลุ่ม LINE แล้วครับ\n\n📌 **Group ID:** ${groupId}\n🕐 **เวลา:** ${now}\n\nพร้อมแปลภาษาและสรุปงานให้ทีมแล้วครับ 🙏`, 'green')
        .catch(e => console.error('[JOIN] Lark failed:', e.message));
      continue;
    }

    if (event.type === 'leave') {
      const groupId = event.source?.groupId ?? event.source?.roomId ?? 'unknown';
      const now = new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' });
      console.log(`[LEAVE] ${groupId}`);
      sendAlertCard('⚠️ วิสดอมถูกนำออกจากกลุ่ม',
        `🚨 **วิสดอม (위즈덤)** ถูกนำออกจากกลุ่ม LINE\n\n📌 **Group ID:** ${groupId}\n🕐 **เวลา:** ${now}\n\n⚠️ หากต้องการให้บอทกลับมา กรุณาเพิ่มเข้ากลุ่มใหม่ครับ`, 'red')
        .catch(e => console.error('[LEAVE] Lark failed:', e.message));
      continue;
    }

    if (event.type !== 'message' || event.message?.type !== 'text') continue;
    // Skip private (1-on-1) chats — staff replies directly
    if (event.source?.type === 'user') continue;
    const text = event.message.text?.trim();
    if (!text) continue;

    const sourceId = event.source?.groupId ?? event.source?.roomId ?? event.source?.userId ?? 'unknown';
    const inBizHours = isBusinessHours();
    const isWorking = isWorkingDay(new Date());
    const timestamp = new Date(event.timestamp).toISOString();

    let senderName = 'ผู้ใช้';
    try { senderName = await withTimeout(getSenderName(event), 3000, 'getSenderName'); } catch (_) {}

    recordActivity(sourceId, senderName, text);

    // ① AI Urgent TRIGGER
    if (isAIUrgentTrigger(text)) {
      activateAIUrgent(sourceId);
      await replyMessages(event.replyToken, [{
        type: 'text',
        text: 'สวัสดีครับ 🤖 มีอะไรให้น้องวิสดอมช่วยค้นหาหรือช่วยเหลือด้านใดครับ\n\n✅ ถามอะไรก็ได้เลยครับ — ธุรกิจ กฎหมายไทย ราชการ เทคโนโลยี การเงิน วิทยาศาสตร์ ทุกศาสตร์ทั่วโลก\n\n(พิมพ์ "ขอบคุณ" เมื่อถามเสร็จแล้วครับ)',
      }]).catch(e => console.error('[AI Urgent] reply failed:', e.message));
      continue;
    }

    // ② Active AI Urgent SESSION
    if (isAIUrgentActive(sourceId)) {
      if (DEACTIVATE_WORDS.test(text.trim())) {
        deactivateAIUrgent(sourceId);
        await replyMessages(event.replyToken, [{
          type: 'text', text: 'ยินดีให้บริการเสมอครับ 🙏 วิสดอมพร้อมช่วยเหลือตลอดเวลานะครับ',
        }]).catch(e => console.error('[AI Urgent] deactivate reply failed:', e.message));
        continue;
      }
      try {
        console.log(`[AI Urgent] answering "${text.slice(0, 50)}..."`);
        const result = await withTimeout(answerAIUrgent(text, senderName), 28000, 'AI Urgent');
        const answerText = (result && typeof result === 'object') ? result.text : result;
        const imageUrl = (result && typeof result === 'object') ? result.imageUrl : null;
        const lineReplies = toLineMessages('🤖 วิสดอม: ', answerText);
        if (imageUrl) lineReplies.push({ type: 'image', originalContentUrl: imageUrl, previewImageUrl: imageUrl });
        await replyMessages(event.replyToken, lineReplies.slice(0, 5))
          .catch(e => console.error('[AI Urgent] LINE reply failed:', e.message));
        const now = new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' });
        sendSummaryCard(
          `🤖 AI Urgent — ${senderName} · ${now}`,
          `❓ **คำถาม:** ${text}\n\n💡 **วิสดอมตอบ:**\n${answerText}`
        ).catch(e => console.error('[AI Urgent] Lark send failed:', e.message));
      } catch (err) { console.error('[AI Urgent] silent-fail:', err.message); }
      continue;
    }

    // ③ Summary keyword
    if (isSummaryRequest(text)) {
      try {
        const msgs = flushMessages();
        if (!msgs.length) {
          await sendSummaryCard('📋 ไม่มีข้อความที่จะสรุป', 'ยังไม่มีข้อความสะสมในระบบครับ');
        } else {
          const summary = await withTimeout(summarizeForLark(msgs, sourceId), 25000, 'summarize');
          const now = new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' });
          await sendSummaryCard(
            `📋 สรุปบทสนทนา LINE — ${now}`,
            `📌 **ขอโดย:** ${senderName}\n📊 **จำนวน:** ${msgs.length} ข้อความ\n\n${summary}`
          );
        }
      } catch (err) { console.error('[webhook] summary error:', err.message); }
      continue;
    }

    // Skip stale events — reply token already expired (LINE cold-start retry after redeploy)
    const eventAge = Date.now() - (event.timestamp || 0);
    if (eventAge > 55000) {
      console.log(`[webhook] stale event skip — ${Math.round(eventAge / 1000)}s old, groupId=${sourceId.slice(0,8)}`);
      continue;
    }

    // Schedule translation only for regular messages (token not consumed by AI Urgent / summary)
    scheduleTranslation(sourceId, text, event.replyToken);

    // ④ Off-hours buffer
    if (!inBizHours || !isWorking) addOffHoursMessage(sourceId, { timestamp, senderName, text });

    // ⑤ Business-hours buffer for hourly pipeline
    const groupName = await getGroupName(event.source?.groupId ?? null);
    if (inBizHours && isWorking) addMessage({ timestamp, senderName, text, groupName });
  }
});

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log('\n🚀 วิสดอม (위즈덤) Server on port ' + PORT);
  console.log('  Bangkok time  : ' + getBangkokTime());
  console.log('  Business hrs  : ' + (isBusinessHours() ? 'YES ✅' : 'NO ❌'));
  console.log('  LINE TOKEN    : ' + (process.env.LINE_CHANNEL_ACCESS_TOKEN || 'EMPTY ❌').substring(0, 12) + '...');
  console.log('  Push fallback : ENABLED (replyMessages re-throws → .catch fires)');
  startCronJob();
  startKeepAlive();
});
