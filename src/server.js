/**
 * server.js
 * Express webhook server with:
 *   - Thai→KR, Korean→TH, English→KR+TH translation (24/7)
 *   - Keyword "สรุป" → AI summary → send to Lark immediately
 *   - Stale-chat tracking (15m🟡 / 30m🔴 alerts via cronJob)
 *   - Off-hours message buffering for morning delivery
 *   - Business-hours message buffering for hourly Lark tasks
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
const { sendToLarkGroup, sendAlertCard } = require('./larkMessenger');
const { recordActivity, addOffHoursMessage } = require('./messageTracker');

const app  = express();
const PORT = process.env.PORT ?? 3000;

app.use(express.json({ verify: (req, _res, buf) => { req.rawBody = buf; } }));

const SUMMARY_KEYWORDS = ['สรุป', 'สรุปงาน', 'สรุปแชท', '/สรุป', 'summary', '/summary'];
function isSummaryRequest(text) {
  const t = text.trim().toLowerCase();
  return SUMMARY_KEYWORDS.some(k => t === k || t.startsWith(k + ' '));
}

// ─── Health check ─────────────────────────────────────────────────────────────
app.get('/', (_req, res) => res.json({
  status: 'ok',
  bangkokTime:   getBangkokTime(),
  businessHours: isBusinessHours(),
  workingDay:    isWorkingDay(new Date()),
}));

// ─── Manual pipeline trigger ──────────────────────────────────────────────────
app.post('/trigger', async (_req, res) => {
  await runPipeline();
  res.json({ status: 'pipeline executed' });
});

// ─── E2E test ─────────────────────────────────────────────────────────────────
app.get('/e2e-test', async (_req, res) => {
  try {
    const fakeMessages = [
      { timestamp: new Date().toISOString(), senderName: 'ทดสอบ', text: 'ประชุมกับลูกค้า ABC เรื่องสัญญาใหม่' },
      { timestamp: new Date().toISOString(), senderName: 'ทดสอบ', text: 'ส่งเอกสาร visa application ให้ทีม HR' },
      { timestamp: new Date().toISOString(), senderName: 'ทดสอบ', text: 'อัพเดต timeline งาน Legal ให้ผู้บริหาร' },
    ];
    const summary = await summarizeForLark(fakeMessages, 'e2e-test-group');
    const now = new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' });
    const larkText = '[E2E Test] สรุปบทสนทนา LINE (' + now + ')\nจำนวนข้อความ: ' + fakeMessages.length + ' รายการ\n\n' + summary;
    const msgId = await sendToLarkGroup(larkText);
    res.json({ success: !!msgId, msgId, larkText });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── LINE Webhook ─────────────────────────────────────────────────────────────
app.post('/webhook', async (req, res) => {
  const signature = req.headers['x-line-signature'];
  if (!signature || !verifySignature(req.rawBody, signature)) {
    return res.status(401).json({ error: 'Invalid signature' });
  }

  res.sendStatus(200);

  for (const event of req.body.events ?? []) {
    if (event.type !== 'message' || event.message?.type !== 'text') continue;

    const text      = event.message.text?.trim();
    const timestamp = new Date(event.timestamp).toISOString();
    if (!text) continue;

    const sourceId   = event.source?.groupId ?? event.source?.roomId ?? event.source?.userId ?? 'unknown';
    const inBizHours = isBusinessHours();
    const isWorking  = isWorkingDay(new Date());
    const senderName = await getSenderName(event);

    // 1. Record activity — resets stale-chat alert timer
    recordActivity(sourceId, senderName, text);

    // 2. "สรุป" keyword → immediate AI summary → Lark
    if (isSummaryRequest(text)) {
      await replyMessages(event.replyToken, [{ type: 'text', text: '📋 กำลังสรุปงานและส่งไป Lark นะครับ รอสักครู่...' }]);
      const msgs = flushMessages();
      if (!msgs.length) {
        await sendToLarkGroup('📋 ยังไม่มีข้อความในกลุ่มนี้ที่จะสรุปครับ');
      } else {
        const summary = await summarizeForLark(msgs, sourceId);
        const now = new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' });
        await sendAlertCard(
          '📋 สรุปบทสนทนา LINE — ' + now,
          'ผู้ขอสรุป: ' + senderName + '\nจำนวนข้อความ: ' + msgs.length + ' รายการ\n\n' + summary,
          'blue'
        );
      }
      continue;
    }

    // 3. Off-hours buffer
    if (!inBizHours || !isWorking) {
      addOffHoursMessage(sourceId, { timestamp, senderName, text });
    }

    // 4. Translate and reply (24/7)
    //    Thai → KR only | Korean → TH only | English → KR + TH
    const translations = await translateAll(text);
    const replies = [];
    if (translations?.kr) replies.push({ type: 'text', text: 'KR: ' + translations.kr });
    if (translations?.th) replies.push({ type: 'text', text: 'TH: ' + translations.th });
    if (!inBizHours)      replies.push({ type: 'text', text: OOO_MESSAGE });
    if (replies.length)   await replyMessages(event.replyToken, replies);

    // 5. Business-hours buffer for hourly Lark task pipeline
    if (inBizHours && isWorking) {
      addMessage({ timestamp, senderName, text });
    }
  }
});

// ─── Setup webhook (one-time helper) ─────────────────────────────────────────
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

// ─── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log('\n Server running on port ' + PORT);
  console.log('   Bangkok time : ' + getBangkokTime());
  console.log('   Business hrs : ' + (isBusinessHours() ? 'YES' : 'NO'));
  startCronJob();
  startKeepAlive();
});
