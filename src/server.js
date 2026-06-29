/**
 * server.js — LINE → อูจิน AI → Lark
 *
 * Rooms:
 *  📣 All Updates  → hourly pipeline (main hub)
 *  🚨 Alert room   → stale-chat alerts (cronJob)
 *  📋 Summary room → สรุป keyword + morning/evening summaries + AI analysis
 *
 * New: AI Urgent mode (triggered by "AI Urgent" in LINE group)
 *  → อูจินตอบกลับใน LINE กลุ่มนั้นทันที ด้วย Gemini Flash
 *  → ส่งคำตอบไป Lark ด้วย
 *
 * New: Background question detection
 *  → เมื่อตรวจพบคำถาม → วิเคราะห์ส่งไป Lark เท่านั้น (ไม่ตอบ LINE)
 */
require('dotenv').config();
const express = require('express');
const axios   = require('axios');
const { isBusinessHours, getBangkokTime } = require('./timeRouter');
const { isWorkingDay }  = require('./holidays');
const { addMessage, flushMessages } = require('./messageStore');
const {
  verifySignature, translateAll, replyMessages, getSenderName,
} = require('./lineHandler');
const { startCronJob, runPipeline } = require('./cronJob');
const { startKeepAlive }  = require('./keepAlive');
const { summarizeForLark } = require('./aiSummarizer');
const { sendToLarkGroup, sendSummaryCard, sendAlertCard } = require('./larkMessenger');
const { recordActivity, addOffHoursMessage } = require('./messageTracker');
const { isQuestion, answerAIUrgent, analyzeForLark } = require('./smartAdvisor');

const app  = express();
const PORT = process.env.PORT ?? 3000;
const LINE_TOKEN   = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const WEBHOOK_URL  = 'https://line-to-lark-automation.onrender.com/webhook';

// ── AI Urgent Sessions ─────────────────────────────────────────────────────────
// Per-group session map: groupId → expiresAt (ms timestamp)
const aiUrgentSessions = new Map();
const AI_URGENT_TTL = 30 * 60 * 1000; // 30 minutes

function isAIUrgentTrigger(text) {
  return /^ai\s*urgent$/i.test(text.trim());
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

// ── LINE 5,000-char limit guard ────────────────────────────────────────────────
const MAX_LINE_TEXT = 4900;
function toLineMessages(prefix, text) {
  const full = prefix + text;
  if (full.length <= MAX_LINE_TEXT) return [{ type:'text', text:full }];
  const chunks = [];
  for (let i=0; i<full.length && chunks.length<5; i+=MAX_LINE_TEXT)
    chunks.push({ type:'text', text:full.slice(i, i+MAX_LINE_TEXT) });
  return chunks;
}

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_,reject) => setTimeout(()=>reject(new Error(`${label} timed out after ${ms}ms`)), ms)),
  ]);
}

app.use(express.json({ verify:(req,_res,buf)=>{ req.rawBody=buf; } }));

const SUMMARY_KEYWORDS = ['สรุป','สรุปงาน','สรุปแชท','/สรุป','summary','/summary'];
function isSummaryRequest(text) {
  const t = text.trim().toLowerCase();
  return SUMMARY_KEYWORDS.some(k => t===k || t.startsWith(k+' '));
}

// ── Health check ───────────────────────────────────────────────────────────────
app.get('/', (_req,res) => res.json({
  status:'ok', bangkokTime:getBangkokTime(),
  businessHours:isBusinessHours(), workingDay:isWorkingDay(new Date()),
  aiUrgentSessions:[...aiUrgentSessions.keys()],
  rooms:{hub:'oc_626fd292d23700898b50fd059c1798ed',alert:'oc_339458a388434ff81afde59342b511b3',summary:'oc_a62e855cfd58229964b2d68b224288b8'},
}));

app.get('/check-webhook', async (_req,res) => {
  try {
    const r = await axios.get('https://api.line.me/v2/bot/channel/webhook/endpoint',
      {headers:{Authorization:`Bearer ${LINE_TOKEN}`}});
    res.json({current:r.data,expected:WEBHOOK_URL,match:r.data.endpoint===WEBHOOK_URL});
  } catch(err){ res.status(500).json({error:err.response?.data??err.message}); }
});

app.post('/setup-webhook', async (_req,res) => {
  try {
    const r = await axios.put('https://api.line.me/v2/bot/channel/webhook/endpoint',
      {webhookEndpointUrl:WEBHOOK_URL},
      {headers:{Authorization:`Bearer ${LINE_TOKEN}`,'Content-Type':'application/json'}});
    res.json({set:WEBHOOK_URL,lineResponse:r.data});
  } catch(err){ res.status(500).json({error:err.response?.data??err.message}); }
});

app.post('/trigger', async (_req,res) => { await runPipeline(); res.json({status:'pipeline executed'}); });

app.get('/e2e-test', async (_req,res) => {
  try {
    const fakeMessages = [
      {timestamp:new Date().toISOString(),senderName:'ทดสอบ',text:'ประชุมกับลูกค้า ABC เรื่องสัญญาใหม่'},
      {timestamp:new Date().toISOString(),senderName:'ทดสอบ',text:'ส่งเอกสาร visa application ให้ทีม HR'},
    ];
    const summary = await summarizeForLark(fakeMessages, 'e2e-test');
    const now = new Date().toLocaleString('th-TH',{timeZone:'Asia/Bangkok'});
    const msgId = await sendSummaryCard(`📋 E2E Test — ${now}`,`🧪 ทดสอบระบบสำเร็จ!\n\n${summary}`);
    res.json({success:!!msgId,msgId,room:'summary'});
  } catch(err){ res.status(500).json({error:err.message}); }
});

// ── LINE Webhook ───────────────────────────────────────────────────────────────
app.post('/webhook', async (req,res) => {
  const signature = req.headers['x-line-signature'];
  if (!signature || !verifySignature(req.rawBody, signature))
    return res.status(401).json({error:'Invalid signature'});

  res.sendStatus(200); // reply immediately — replyToken valid 30s

  for (const event of req.body.events ?? []) {

    // ── JOIN ──────────────────────────────────────────────────────────────
    if (event.type === 'join') {
      const groupId = event.source?.groupId ?? event.source?.roomId ?? 'unknown';
      const now = new Date().toLocaleString('th-TH',{timeZone:'Asia/Bangkok'});
      console.log(`[JOIN] ${groupId}`);
      sendAlertCard('✅ อูจินเข้ากลุ่มใหม่',
        `🤖 **อูจิน (우진)** ถูกเพิ่มเข้ากลุ่ม LINE แล้วครับ\n\n📌 **Group ID:** ${groupId}\n🕐 **เวลา:** ${now}\n\nพร้อมแปลภาษาและสรุปงานให้ทีมแล้วครับ 🙏`,'green')
        .catch(e=>console.error('[JOIN] Lark failed:',e.message));
      continue;
    }

    // ── LEAVE ─────────────────────────────────────────────────────────────
    if (event.type === 'leave') {
      const groupId = event.source?.groupId ?? event.source?.roomId ?? 'unknown';
      const now = new Date().toLocaleString('th-TH',{timeZone:'Asia/Bangkok'});
      console.log(`[LEAVE] ${groupId}`);
      sendAlertCard('⚠️ อูจินถูกนำออกจากกลุ่ม',
        `🚨 **อูจิน (우진)** ถูกนำออกจากกลุ่ม LINE\n\n📌 **Group ID:** ${groupId}\n🕐 **เวลา:** ${now}\n\n⚠️ หากต้องการให้บอทกลับมา กรุณาเพิ่มเข้ากลุ่มใหม่ครับ`,'red')
        .catch(e=>console.error('[LEAVE] Lark failed:',e.message));
      continue;
    }

    if (event.type !== 'message' || event.message?.type !== 'text') continue;
    const text = event.message.text?.trim();
    if (!text) continue;

    const sourceId   = event.source?.groupId ?? event.source?.roomId ?? event.source?.userId ?? 'unknown';
    const inBizHours = isBusinessHours();
    const isWorking  = isWorkingDay(new Date());
    const timestamp  = new Date(event.timestamp).toISOString();

    let senderName = 'ผู้ใช้';
    try { senderName = await withTimeout(getSenderName(event), 5000, 'getSenderName'); } catch(_){}

    // 1. Record activity
    recordActivity(sourceId, senderName, text);

    // ── ① AI Urgent TRIGGER ────────────────────────────────────────────────
    if (isAIUrgentTrigger(text)) {
      activateAIUrgent(sourceId);
      await replyMessages(event.replyToken, [{
        type:'text',
        text:'สวัสดีครับ 🤖 มีอะไรให้น้องอูจินช่วยค้นหาหรือช่วยเหลือด้านใดครับ\n\n✅ พิมพ์คำถามได้เลยครับ น้องพร้อมตอบทุกเรื่อง ทั้งธุรกิจ กฎหมาย ราชการ และอื่นๆ\n\n(พิมพ์ "ขอบคุณ" เมื่อเสร็จแล้วครับ)',
      }]).catch(e=>console.error('[AI Urgent] reply failed:',e.message));
      continue;
    }

    // ── ② Active AI Urgent SESSION → answer in LINE + send to Lark ─────────
    if (isAIUrgentActive(sourceId)) {
      // Deactivation keyword
      if (DEACTIVATE_WORDS.test(text.trim())) {
        deactivateAIUrgent(sourceId);
        await replyMessages(event.replyToken, [{
          type:'text', text:'ยินดีให้บริการเสมอครับ 🙏 อูจินพร้อมช่วยเหลือตลอดเวลานะครับ',
        }]).catch(e=>console.error('[AI Urgent] deactivate reply failed:',e.message));
        continue;
      }

      // Answer with Gemini Flash (smartest model)
      try {
        console.log(`[AI Urgent] answering "${text.slice(0,50)}..."`);
        const answer = await withTimeout(answerAIUrgent(text, senderName), 28000, 'AI Urgent');

        // Reply in LINE
        const lineReplies = toLineMessages('🤖 อูจิน: ', answer);
        await replyMessages(event.replyToken, lineReplies.slice(0,5))
          .catch(e=>console.error('[AI Urgent] LINE reply failed:',e.message));

        // Also forward to Lark Summary room for team awareness
        const now = new Date().toLocaleString('th-TH',{timeZone:'Asia/Bangkok'});
        sendSummaryCard(
          `🤖 AI Urgent — ${senderName} · ${now}`,
          `❓ **คำถาม:** ${text}\n\n💡 **อูจินตอบ:**\n${answer}\n\n> 🤖 ตอบโดย Gemini Flash · Wisdom International`
        ).catch(e=>console.error('[AI Urgent] Lark send failed:',e.message));

      } catch(err) {
        console.error('[AI Urgent] answer failed:',err.message);
        await replyMessages(event.replyToken, [{
          type:'text',
          text:'⚠️ ขออภัยครับ ขณะนี้ระบบไม่สามารถตอบได้ชั่วคราว กรุณาลองใหม่อีกครั้งครับ',
        }]).catch(()=>{});
      }
      continue; // don't translate in AI Urgent mode
    }

    // ── ③ Summary keyword ──────────────────────────────────────────────────
    if (isSummaryRequest(text)) {
      try {
        await replyMessages(event.replyToken, [{type:'text',text:'📋 กำลังสรุปงานและส่งไป Lark นะครับ รอสักครู่...'}]);
        const msgs = flushMessages();
        if (!msgs.length) {
          await sendSummaryCard('📋 ไม่มีข้อความที่จะสรุป','ยังไม่มีข้อความสะสมในระบบครับ');
        } else {
          const summary = await withTimeout(summarizeForLark(msgs, sourceId), 25000, 'summarize');
          const now = new Date().toLocaleString('th-TH',{timeZone:'Asia/Bangkok'});
          await sendSummaryCard(
            `📋 สรุปบทสนทนา LINE — ${now}`,
            `📌 **ขอโดย:** ${senderName}\n📊 **จำนวน:** ${msgs.length} ข้อความ\n\n${summary}`
          );
        }
      } catch(err){ console.error('[webhook] summary error:',err.message); }
      continue;
    }

    // ── ④ Off-hours buffer ─────────────────────────────────────────────────
    if (!inBizHours || !isWorking)
      addOffHoursMessage(sourceId, {timestamp,senderName,text});

    // ── ⑤ Translate 24/7 ──────────────────────────────────────────────────
    try {
      const translations = await withTimeout(translateAll(text), 20000, 'translateAll');
      const replies = [];
      if (translations?.kr) replies.push(...toLineMessages('KR: ', translations.kr));
      if (translations?.th) replies.push(...toLineMessages('TH: ', translations.th));
      if (replies.length)
        await replyMessages(event.replyToken, replies.slice(0,5))
          .catch(e=>console.error('[webhook] reply error:',e.message, e.response?.data ? JSON.stringify(e.response.data) : ''));
    } catch(err) {
      console.error('[webhook] translate error:',err.message);
      replyMessages(event.replyToken, [{type:'text',text:'⚠️ ขณะนี้ระบบแปลชั่วคราวไม่พร้อมใช้งาน กรุณาลองใหม่อีกครั้งครับ'}]).catch(()=>{});
    }

    // ── ⑥ Business-hours buffer for hourly pipeline ────────────────────────
    if (inBizHours && isWorking) addMessage({timestamp,senderName,text});

    // ── ⑦ Background: detect questions → analyze → send to Lark ONLY ───────
    if (isQuestion(text)) {
      analyzeForLark(text, senderName, sourceId)
        .catch(e=>console.error('[SmartAdvisor] bg failed:',e.message));
    }
  }
});

// ── Start ──────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log('\n🚀 อูจิน (우진) Server on port ' + PORT);
  console.log(' Bangkok time : ' + getBangkokTime());
  console.log(' Business hrs : ' + (isBusinessHours() ? 'YES ✅' : 'NO ❌'));
  console.log(' AI Urgent    : ready (trigger: "AI Urgent" in LINE)');
  console.log(' Smart Brain  : 8-tier cascade + Thai Legal KB');
  startCronJob();
  startKeepAlive();
});
