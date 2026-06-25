/**
 * server.js — LINE → Groq AI → Lark
 * Rooms:
 *   📣 All Updates  → hourly pipeline (main hub)
 *   🚨 Alert room   → stale-chat yellow/red alerts (cronJob)
 *   📋 Summary room → สรุป keyword + morning/evening summaries
 */
require('dotenv').config();
const express = require('express');
const { isBusinessHours, getBangkokTime } = require('./timeRouter');
const { isWorkingDay }   = require('./holidays');
const { addMessage, flushMessages } = require('./messageStore');
const {
  verifySignature, translateAll,
  replyMessages, getSenderName, OOO_MESSAGE,
} = require('./lineHandler');
const { startCronJob, runPipeline } = require('./cronJob');
const { startKeepAlive }            = require('./keepAlive');
const { summarizeForLark }          = require('./aiSummarizer');
const { sendToLarkGroup, sendSummaryCard } = require('./larkMessenger');
const { recordActivity, addOffHoursMessage } = require('./messageTracker');

const app  = express();
const PORT = process.env.PORT ?? 3000;

app.use(express.json({ verify: (req, _res, buf) => { req.rawBody = buf; } }));

const SUMMARY_KEYWORDS = ['สรุป','สรุปงาน','สรุปแชท','/สรุป','summary','/summary'];
function isSummaryRequest(text) {
  const t = text.trim().toLowerCase();
  return SUMMARY_KEYWORDS.some(k => t === k || t.startsWith(k + ' '));
}

// ── Health check ──────────────────────────────────────────────────────────────
app.get('/', (_req, res) => res.json({
  status: 'ok',
  bangkokTime:   getBangkokTime(),
  businessHours: isBusinessHours(),
  workingDay:    isWorkingDay(new Date()),
  rooms: {
    hub:     'oc_626fd292d23700898b50fd059c1798ed',
    alert:   'oc_339458a388434ff81afde59342b511b3',
    summary: 'oc_a62e855cfd58229964b2d68b224288b8',
  },
}));

// ── Manual pipeline trigger ───────────────────────────────────────────────────
app.post('/trigger', async (_req, res) => {
  await runPipeline();
  res.json({ status: 'pipeline executed' });
});

// ── E2E test ──────────────────────────────────────────────────────────────────
app.get('/e2e-test', async (_req, res) => {
  try {
    const fakeMessages = [
      { timestamp: new Date().toISOString(), senderName: 'ทดสอบ', text: 'ประชุมกับลูกค้า ABC เรื่องสัญญาใหม่' },
      { timestamp: new Date().toISOString(), senderName: 'ทดสอบ', text: 'ส่งเอกสาร visa application ให้ทีม HR' },
      { timestamp: new Date().toISOString(), senderName: 'ทดสอบ', text: 'อัพเดต timeline งาน Legal ให้ผู้บริหาร' },
    ];
    const summary = await summarizeForLark(fakeMessages, 'e2e-test');
    const now = new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' });
    const msgId = await sendSummaryCard(
      `📋 E2E Test — ${now}`,
      `🧪 ทดสอบระบบสำเร็จ!\nจำนวนข้อความ: ${fakeMessages.length} รายการ\n\n${summary}`
    );
    res.json({ success: !!msgId, msgId, room: 'summary' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── LINE Webhook ──────────────────────────────────────────────────────────────
app.post('/webhook', async (req, res) => {
  const signature = req.headers['x-line-signature'];
  if (!signature || !verifySignature(req.rawBody, signature)) {
    return res.status(401).json({ error: 'Invalid signature' });
  }
  res.sendStatus(200);

  for (const event of req.body.events ?? []) {
    if (event.type !== 'message' || event.message?.type !== 'text') continue;
    const text = event.message.text?.trim();
    if (!text) continue;

    const sourceId   = event.source?.groupId ?? event.source?.roomId ?? event.source?.userId ?? 'unknown';
    const inBizHours = isBusinessHours();
    const isWorking  = isWorkingDay(new Date());
    const timestamp  = new Date(event.timestamp).toISOString();
    const senderName = await getSenderName(event);

    // 1. Record activity — resets stale-chat alert timer
    recordActivity(sourceId, senderName, text);

    // 2. สรุป keyword → immediate summary → 📋 Summary room
    if (isSummaryRequest(text)) {
      await replyMessages(event.replyToken, [{ type: 'text', text: '📋 กำลังสรุปงานและส่งไป Lark นะครับ รอสักครู่...' }]);
      const msgs = flushMessages();
      if (!msgs.length) {
        await sendSummaryCard('📋 ไม่มีข้อความที่จะสรุป', 'ยังไม่มีข้อความสะสมในระบบครับ');
      } else {
        const summary = await summarizeForLark(msgs, sourceId);
        const now = new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' });
        await sendSummaryCard(
          `📋 สรุปบทสนทนา LINE — ${now}`,
          `📌 **ขอโดย:** ${senderName}\n📊 **จำนวน:** ${msgs.length} ข้อความ\n\n${summary}`
        );
      }
      continue;
    }

    // 3. Off-hours buffer
    if (!inBizHours || !isWorking) {
      addOffHoursMessage(sourceId, { timestamp, senderName, text });
    }

    // 4. Translate & reply (24/7)
    //    Thai → KR | Korean → TH | English → KR + TH
    const translations = await translateAll(text);
    const replies = [];
    if (translations?.kr) replies.push({ type: 'text', text: 'KR: ' + translations.kr });
    if (translations?.th) replies.push({ type: 'text', text: 'TH: ' + translations.th });
    if (!inBizHours)      replies.push({ type: 'text', text: OOO_MESSAGE });
    if (replies.length)   await replyMessages(event.replyToken, replies);

    // 5. Business-hours buffer for hourly pipeline
    if (inBizHours && isWorking) {
      addMessage({ timestamp, senderName, text });
    }
  }
});

// ── Setup webhook (one-time helper) ──────────────────────────────────────────
app.get('/setup-webhook', async (_req, res) => {
  try {
    const webhookUrl = 'https://line-to-lark-automation.onrender.com/webhook';
    const r = await require('axios').put(
      'https://api.line.me/v2/bot/channel/webhook/endpoint',
      { webhookEndpointUrl: webhookUrl },
      { headers: { Authorization: 'Bearer ' + process.env.LINE_CHANNEL_ACCESS_TOKEN } }
    );
    res.json({ set: webhookUrl, lineResponse: r.data });
  } catch (err) {
    res.status(500).json({ error: err.response?.data ?? err.message });
  }
});

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log('\n🚀 Server running on port ' + PORT);
  console.log('   Bangkok time : ' + getBangkokTime());
  console.log('   Business hrs : ' + (isBusinessHours() ? 'YES ✅' : 'NO ❌'));
  console.log('   Rooms ready  : Hub | Alert | Summary');
  startCronJob();
  startKeepAlive();
});
