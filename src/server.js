/**
 * server.js
 * Entry point. Bootstraps the Express webhook server, hourly cron job,
 * and the keep-alive pinger (free Render plan — prevents sleep).
 *
 * LINE Webhook setup:
 *   1. Deploy this server (Render → Blueprint using render.yaml).
 *   2. Set Webhook URL in LINE Developers Console:
 *      https://<your-render-url>/webhook
 *   3. Enable "Use webhook" toggle.
 */

require('dotenv').config();

const express          = require('express');
const { isBusinessHours, getBangkokTime } = require('./timeRouter');
const { addMessage }   = require('./messageStore');
const { verifySignature, replyOOO, getSenderName } = require('./lineHandler');
const { startCronJob, runPipeline } = require('./cronJob');
const { startKeepAlive }            = require('./keepAlive');

const app  = express();
const PORT = process.env.PORT ?? 3000;

// ── Raw body capture (required for LINE signature verification) ───────────────
app.use(
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  })
);

// ── Health check ──────────────────────────────────────────────────────────────
app.get('/', (_req, res) => {
  res.json({
    status: 'ok',
    bangkokTime: getBangkokTime(),
    businessHours: isBusinessHours(),
  });
});

// ── Manual trigger (for testing without waiting for cron) ─────────────────────
app.post('/trigger', async (_req, res) => {
  console.log('[Manual] Pipeline triggered via /trigger endpoint');
  await runPipeline();
  res.json({ status: 'pipeline executed' });
});

// ── LINE Webhook ──────────────────────────────────────────────────────────────
app.post('/webhook', async (req, res) => {
  const signature = req.headers['x-line-signature'];
  if (!signature || !verifySignature(req.rawBody, signature)) {
    console.warn('[Webhook] Invalid signature -- request rejected.');
    return res.status(401).json({ error: 'Invalid signature' });
  }

  // LINE expects 200 OK back immediately; process events asynchronously.
  res.sendStatus(200);

  const events = req.body.events ?? [];

  for (const event of events) {
    if (event.type !== 'message' || event.message?.type !== 'text') continue;

    const replyToken = event.replyToken;
    const text       = event.message.text?.trim();
    const timestamp  = new Date(event.timestamp).toISOString();

    if (!text) continue;

    if (!isBusinessHours()) {
      await replyOOO(replyToken);
      console.log('[Webhook] OOO reply sent for: "' + text.slice(0, 40) + '"');
    } else {
      const senderName = await getSenderName(event);
      addMessage({ timestamp, senderName, text });
      console.log('[Webhook] Buffered from ' + senderName + ': "' + text.slice(0, 40) + '"');
    }
  }
});

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log('\n Server running on port ' + PORT);
  console.log('   Bangkok time : ' + getBangkokTime());
  console.log('   Business hrs : ' + (isBusinessHours() ? 'YES' : 'NO'));
  startCronJob();
  startKeepAlive();
});
