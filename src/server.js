/**
 * server.js
 * Entry point. Bootstraps the Express webhook server, hourly cron job,
 * and the keep-alive pinger (free Render plan — prevents sleep).
 *
 * Features:
 *   - Thai to Korean translation 24/7 for every message in the group
 *   - Business hours 09:00-18:00 BKK: buffer messages for hourly Lark tasks
 *   - Outside hours: OOO reply appended after translation if any
 */

require('dotenv').config();

const express = require('express');
const { isBusinessHours, getBangkokTime } = require('./timeRouter');
const { addMessage }   = require('./messageStore');
const {
  verifySignature,
  translateToKorean,
  replyMessages,
  getSenderName,
  OOO_MESSAGE,
} = require('./lineHandler');
const { startCronJob, runPipeline } = require('./cronJob');
const { startKeepAlive }            = require('./keepAlive');

const app  = express();
const PORT = process.env.PORT ?? 3000;

// Raw body capture (required for LINE signature verification)
app.use(
  express.json({
    verify: (req, _res, buf) => { req.rawBody = buf; },
  })
);

// Health check
app.get('/', (_req, res) => {
  res.json({
    status: 'ok',
    bangkokTime: getBangkokTime(),
    businessHours: isBusinessHours(),
  });
});

// Manual pipeline trigger
app.post('/trigger', async (_req, res) => {
  console.log('[Manual] Pipeline triggered via /trigger endpoint');
  await runPipeline();
  res.json({ status: 'pipeline executed' });
});

// LINE Webhook
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

    if (!text) continue;

    // 1. Translate Thai to Korean (24/7)
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

    // 3. Buffer for Lark tasks during business hours
    if (inBizHours) {
      const senderName = await getSenderName(event);
      addMessage({ timestamp, senderName, text });
      console.log('[Webhook] Buffered from ' + senderName + ': "' + text.slice(0, 40) + '"');
    }
  }
});

// Setup webhook (one-time helper)
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

// Start
app.listen(PORT, () => {
  console.log('\n Server running on port ' + PORT);
  console.log('   Bangkok time : ' + getBangkokTime());
  console.log('   Business hrs : ' + (isBusinessHours() ? 'YES' : 'NO'));
  startCronJob();
  startKeepAlive();
});
