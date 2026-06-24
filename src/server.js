/**
 * server.js – keyword-triggered Lark summary + Thai↔Korean translation
 */
require('dotenv').config();

const express = require('express');
const { isBusinessHours, getBangkokTime } = require('./timeRouter');
const { addMessage, addGroupMessage, flushGroupMessages } = require('./messageStore');
const {
  verifySignature,
  translateToKorean,
  replyMessages,
  getSenderName,
  OOO_MESSAGE,
} = require('./lineHandler');
const { startCronJob, runPipeline } = require('./cronJob');
const { startKeepAlive }            = require('./keepAlive');
const { summarizeForLark }          = require('./aiSummarizer');
const { sendToLarkGroup, listBotChats } = require('./larkMessenger');

const app  = express();
const PORT = process.env.PORT ?? 3000;

const SUMMARY_KEYWORDS = ['สรุป','สรุปงาน','สรุปงานวันนี้','/สรุป','summary','/summary','สรุปแชท'];

function isSummaryRequest(text) {
  const t = text.trim().toLowerCase();
  return SUMMARY_KEYWORDS.some(k => t === k || t.startsWith(k + ' ') || t.endsWith(' ' + k));
}

function getSourceId(event) {
  return event.source?.groupId ?? event.source?.roomId ?? event.source?.userId ?? 'unknown';
}

app.use(express.json({ verify: (req, _res, buf) => { req.rawBody = buf; } }));

app.get('/', (_req, res) => {
  res.json({ status: 'ok', bangkokTime: getBangkokTime(), businessHours: isBusinessHours() });
});

app.get('/lark-chats', async (_req, res) => {
  const chats = await listBotChats();
  res.json({ count: chats.length, chats });
});

app.post('/trigger', async (_req, res) => {
  await runPipeline();
  res.json({ status: 'pipeline executed' });
});

app.post('/webhook', async (req, res) => {
  const signature = req.headers['x-line-signature'];
  if (!signature || !verifySignature(req.rawBody, signature)) {
    return res.status(401).json({ error: 'Invalid signature' });
  }
  res.sendStatus(200);

  const events = req.body.events ?? [];
  for (const event of events) {
    if (event.type !== 'message' || event.message?.type !== 'text') continue;
    const replyToken = event.replyToken;
    const text       = event.message.text?.trim();
    const timestamp  = new Date(event.timestamp).toISOString();
    const sourceId   = getSourceId(event);
    if (!text) continue;

    if (isSummaryRequest(text)) {
      console.log('[Webhook] Summary requested in: ' + sourceId);
      await replyMessages(replyToken, [{ type: 'text', text: 'กำลังสรุปงานและส่งไป Lark นะครับ รอสักครู่...' }]);
      const groupMsgs = flushGroupMessages(sourceId);
      if (groupMsgs.length === 0) {
        console.log('[Webhook] No buffered messages.');
        continue;
      }
      const senderName = await getSenderName(event);
      const summary = await summarizeForLark(groupMsgs, sourceId);
      const now = new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' });
      const larkText = 'สรุปบทสนทนา LINE (' + now + ')\n' +
        'กลุ่ม: ' + sourceId + '\n' +
        'ผู้ขอสรุป: ' + senderName + '\n' +
        'จำนวนข้อความ: ' + groupMsgs.length + ' รายการ\n\n' + summary;
      const msgId = await sendToLarkGroup(larkText);
      if (msgId) console.log('[Webhook] Summary sent to Lark: ' + msgId);
      continue;
    }

    const koreanText = await translateToKorean(text);
    const inBizHours = isBusinessHours();
    const replies = [];
    if (koreanText) replies.push({ type: 'text', text: 'KR: ' + koreanText });
    if (!inBizHours) replies.push({ type: 'text', text: OOO_MESSAGE });
    if (replies.length > 0) await replyMessages(replyToken, replies);

    if (inBizHours) {
      const senderName = await getSenderName(event);
      const msg = { timestamp, senderName, text };
      addMessage(msg);
      addGroupMessage(sourceId, msg);
    }
  }
});

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

app.listen(PORT, () => {
  console.log('Server running on port ' + PORT);
  startCronJob();
  startKeepAlive();
});
