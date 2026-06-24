/**
 * server.js
 * Entry point. Bootstraps the Express webhook server, hourly cron job,
 * and the keep-alive pinger (free Render plan â prevents sleep).
 *
 * Features:
 *   - Thai â Korean translation 24/7 for every message in the group
 *   - Business hours 09:00-18:00 BKK: buffer messages for hourly Lark tasks
 *   - Outside hours: OOO reply appended after translation if any
 *   - Keyword trigger (à¸ªà¸£à¸¸à¸/summary): AI summarises group chat â sends to Lark
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

// ââ Keyword detection âââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
// Trigger phrases that request an immediate summary to Lark
const SUMMARY_KEYWORDS = [
  'à¸ªà¸£à¸¸à¸', 'à¸ªà¸£à¸¸à¸à¸à¸²à¸', 'à¸ªà¸£à¸¸à¸à¸à¸²à¸à¸§à¸±à¸à¸à¸µà¹', '/à¸ªà¸£à¸¸à¸',
  'summary', '/summary', 'à¸ªà¸£à¸¸à¸à¹à¸à¸',
];

function isSummaryRequest(text) {
  const t = text.trim().toLowerCase();
  return SUMMARY_KEYWORDS.some(k => t === k || t.startsWith(k + ' ') || t.endsWith(' ' + k));
}

// Get a source label for the group (groupId, roomId, or userId)
function getSourceId(event) {
  return event.source?.groupId ?? event.source?.roomId ?? event.source?.userId ?? 'unknown';
}

// ââ Middleware ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
app.use(
  express.json({
    verify: (req, _res, buf) => { req.rawBody = buf; },
  })
);

// ââ Health check ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
app.get('/', (_req, res) => {
  res.json({
    status: 'ok',
    bangkokTime: getBangkokTime(),
    businessHours: isBusinessHours(),
  });
});

// ââ Helper: list Lark chats (find LARK_CHAT_ID) âââââââââââââââââââââââââââââââ
app.get('/lark-chats', async (_req, res) => {
  const chats = await listBotChats();
  res.json({ count: chats.length, chats });
});

// ââ Manual pipeline trigger âââââââââââââââââââââââââââââââââââââââââââââââââââ
app.post('/trigger', async (_req, res) => {
  console.log('[Manual] Pipeline triggered via /trigger endpoint');
  await runPipeline();
  res.json({ status: 'pipeline executed' });
});

// ââ LINE Webhook ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
app.post('/webhook', async (req, res) => {
  const signature = req.headers['x-line-signature'];
  if (!signature || !verifySignature(req.rawBody, signature)) {
    console.warn('[Webhook] Invalid signature -- request rejected.');
    return res.status(401).json({ error: 'Invalid signature' });
  }

  // Respond 200 immediately; process events asynchronously.
  res.sendStatus(200);

  const events = req.body.events ?? [];

  for (const event of events) {
    if (event.type !== 'message' || event.message?.type !== 'text') continue;

    const replyToken = event.replyToken;
    const text       = event.message.text?.trim();
    const timestamp  = new Date(event.timestamp).toISOString();
    const sourceId   = getSourceId(event);

    if (!text) continue;

    // ââ Check for summary keyword ââââââââââââââââââââââââââââââââââââââââââââ
    if (isSummaryRequest(text)) {
      console.log(`[Webhook] Summary requested in source: ${sourceId}`);

      // Acknowledge immediately in LINE
      await replyMessages(replyToken, [{
        type: 'text',
        text: 'â³ à¸à¸³à¸¥à¸±à¸à¸ªà¸£à¸¸à¸à¸à¸²à¸à¹à¸¥à¸°à¸ªà¹à¸à¹à¸ Lark à¸à¸°à¸à¸£à¸±à¸ à¸£à¸­à¸ªà¸±à¸à¸à¸£à¸¹à¹...',
      }]);

      // Get buffered messages for this group (and keep them in store for cron too)
      const groupMsgs = flushGroupMessages(sourceId);

      if (groupMsgs.length === 0) {
        // Re-use the LINE Push API isn't available on free tier â log only
        console.log('[Webhook] No buffered messages to summarise.');
        continue;
      }

      // AI summarise
      const senderName = await getSenderName(event);
      const groupLabel = sourceId;
      const summary    = await summarizeForLark(groupMsgs, groupLabel);

      // Build Lark message with header
      const now = new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' });
      const larkText =
        `ð *à¸ªà¸£à¸¸à¸à¸à¸à¸ªà¸à¸à¸à¸² LINE* (${now})\n` +
        `ð à¸à¸¥à¸¸à¹à¸¡: ${groupLabel}\n` +
        `ð¤ à¸à¸¹à¹à¸à¸­à¸ªà¸£à¸¸à¸: ${senderName}\n` +
        `ð à¸à¸³à¸à¸§à¸à¸à¹à¸­à¸à¸§à¸²à¸¡: ${groupMsgs.length} à¸£à¸²à¸¢à¸à¸²à¸£\n\n` +
        `${summary}`;

      const msgId = await sendToLarkGroup(larkText);

      // Confirm in LINE
      // Note: replyToken already used above â use push API if available
      // For now just log success
      if (msgId) {
        console.log(`[Webhook] Summary sent to Lark (msg: ${msgId})`);
      }

      continue; // Skip normal translation for this message
    }

    // ââ Normal flow: translate + buffer âââââââââââââââââââââââââââââââââââââ

    // 1. Translate Thai â Korean (24/7)
    const koreanText = await translateToKorean(text);
    const inBizHours = isBusinessHours();

    // 2. Build reply messages
    const replies = [];
    if (koreanText) {
      replies.push({ type: 'text', text: 'KR: ' + koreanText });
      console.log('[Translate] TH->KR: "' + text.slice(0, 30) + '"');
    }
    if (!inBizHours) {
      replies.push({ type: 'text', text: OOO_MESSAGE });
      console.log('[Webhook] OOO appended.');
    }
    if (replies.length > 0) {
      await replyMessages(replyToken, replies);
    }

    // 3. Buffer for cron pipeline AND per-group keyword trigger
    if (inBizHours) {
      const senderName = await getSenderName(event);
      const msg = { timestamp, senderName, text };

      // Global buffer (hourly cron â Lark Tasks)
      addMessage(msg);
      console.log('[Webhook] Buffered from ' + senderName + ': "' + text.slice(0, 40) + '"');

      // Per-group buffer (keyword trigger â Lark Chat summary)
      addGroupMessage(sourceId, msg);
    }
  }
});

// ââ Setup webhook helper ââââââââââââââââââââââââââââââââââââââââââââââââââââââ
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

// ââ Start âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
app.listen(PORT, () => {
  console.log('\n Server running on port ' + PORT);
  console.log('   Bangkok time : ' + getBangkokTime());
  console.log('   Business hrs : ' + (isBusinessHours() ? 'YES' : 'NO'));
  startCronJob();
  startKeepAlive();
});
