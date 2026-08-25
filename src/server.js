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

const LOGS_HTML = `<!DOCTYPE html><html lang="th"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Wisdom Bot Live Logs</title><style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#0d1117;color:#e6edf3;font-family:monospace;font-size:13px;height:100vh;display:flex;flex-direction:column}
header{background:#161b22;border-bottom:1px solid #30363d;padding:10px 16px;display:flex;align-items:center;gap:12px;flex-wrap:wrap}
h1{font-size:15px;color:#58a6ff;white-space:nowrap}
#status{width:10px;height:10px;border-radius:50%;background:#f85149;flex-shrink:0}
#status.ok{background:#3fb950}
.filters{display:flex;gap:6px;flex-wrap:wrap}
.filters button{background:#21262d;border:1px solid #30363d;color:#8b949e;padding:3px 10px;border-radius:6px;cursor:pointer;font-size:12px}
.filters button.active{background:#1f6feb;border-color:#388bfd;color:#fff}
.stats{margin-left:auto;display:flex;gap:12px;font-size:11px;color:#8b949e}
#log{flex:1;overflow-y:auto;padding:8px 12px}
.row{padding:2px 0;border-bottom:1px solid #161b22;display:flex;gap:8px;align-items:flex-start}
.ts{color:#484f58;flex-shrink:0;font-size:11px;padding-top:1px}
.msg{word-break:break-all;line-height:1.5}
.info .msg{color:#e6edf3}
.warn .msg{color:#e3b341}
.error .msg{color:#f85149;font-weight:bold}
.ok .msg{color:#3fb950}
.hit .msg{color:#a5d6ff}
footer{background:#161b22;border-top:1px solid #30363d;padding:6px 12px;font-size:11px;color:#484f58;display:flex;justify-content:space-between;align-items:center}
#autoscroll{accent-color:#58a6ff}
</style></head><body>
<header>
  <span id="status"></span>
  <h1>🤖 Wisdom Bot — Live Logs</h1>
  <div class="filters">
    <button class="active" onclick="setFilter('all',this)">ทั้งหมด</button>
    <button onclick="setFilter('translate',this)">การแปล</button>
    <button onclick="setFilter('error',this)">❌ Error</button>
  </div>
  <div class="stats"><span id="s-ok">✅ 0</span><span id="s-err">❌ 0</span><span id="s-msg">📩 0</span></div>
</header>
<div id="log"></div>
<footer><span id="count">0 รายการ</span><label><input type="checkbox" id="autoscroll" checked> Auto-scroll</label></footer>
<script>
let filter='all', cOk=0, cErr=0, cMsg=0, total=0;
const log=document.getElementById('log'), st=document.getElementById('status');
const sOk=document.getElementById('s-ok'), sErr=document.getElementById('s-err'), sMsg=document.getElementById('s-msg');
const cnt=document.getElementById('count'), as=document.getElementById('autoscroll');

function setFilter(f,btn){filter=f;document.querySelectorAll('.filters button').forEach(b=>b.classList.remove('active'));btn.classList.add('active');document.querySelectorAll('.row').forEach(r=>r.style.display=shouldShow(r.dataset.m)?'flex':'none');}
function shouldShow(m){if(!m)return true;if(filter==='error')return/error|failed|exhausted|429/i.test(m);if(filter==='translate')return/[TR]|[Translate]|[LINE]/i.test(m);return true;}
function rowClass(l,m){if(l==='error'||/error|failed|exhausted/i.test(m))return'error';if(l==='warn'||/429|cooldown|trying next/i.test(m))return'warn';if(/Reply ok|Cache hit|ok/i.test(m))return'ok';if(/Cache hit/i.test(m))return'hit';return'info';}
function addRow(e){
  const cls=rowClass(e.l,e.m);
  total++;cnt.textContent=total+' รายการ';
  if(cls==='ok')cOk++;if(cls==='error'){cErr++;sErr.textContent='❌ '+cErr;}
  if(/Store.*message/i.test(e.m)){cMsg++;sMsg.textContent='📩 '+cMsg;}
  sOk.textContent='✅ '+cOk;
  const d=document.createElement('div');
  d.className='row '+cls;d.dataset.m=e.m;
  d.style.display=shouldShow(e.m)?'flex':'none';
  const ts=e.t.slice(11,19);
  d.innerHTML='<span class="ts">'+ts+'</span><span class="msg">'+e.m.replace(/</g,'&lt;')+'</span>';
  log.appendChild(d);
  if(log.children.length>500)log.removeChild(log.firstChild);
  if(as.checked)log.scrollTop=log.scrollHeight;
}
const es=new EventSource('/logs/stream');
es.onopen=()=>st.className='ok';
es.onerror=()=>st.className='';
es.onmessage=e=>{try{addRow(JSON.parse(e.data));}catch(_){}};
<\/script></body></html>`;

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
      const tr = await withTimeout(translateAll(combined), 50000, 'translateAll');
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
