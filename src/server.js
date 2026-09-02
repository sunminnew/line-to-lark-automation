/**
 * server.js
 * Entry point. Bootstraps the Express webhook server, hourly cron job,
 * and the keep-alive pinger (free Render plan -- prevents sleep).
 *
 * Features:
 *   - Thai<->Korean<->English translation 24/7 for every group message
 *   - Business hours 09:00-18:00 BKK: buffer messages for hourly Lark tasks
 *   - Outside hours: OOO reply appended after translation
 *   - Image messages: read payment slip with Gemini Vision -> record in PEAK Account
 */

require('dotenv').config();

const express = require('express');
const axios   = require('axios');
const { isBusinessHours, getBangkokTime } = require('./timeRouter');
const { addMessage }   = require('./messageStore');
const {
  verifySignature,
  translateAll,
  replyMessages,
  getSenderName,
  OOO_MESSAGE,
} = require('./lineHandler');
const { startCronJob, runPipeline } = require('./cronJob');
const { startKeepAlive }            = require('./keepAlive');
const { readSlip }                  = require('./slipReader');
const { processSlipPayment }        = require('./peakHandler');

const app  = express();
const PORT = process.env.PORT ?? 3000;

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

// LINE push helper
async function pushText(to, text) {
  try {
    await axios.post(
      'https://api.line.me/v2/bot/message/push',
      { to, messages: [{ type: 'text', text }] },
      { headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}` } }
    );
  } catch (err) {
    console.error('[Push] Failed:', err.response?.status ?? err.message);
  }
}

function formatBaht(amount) {
  return '\u0e3f' + Number(amount).toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

// LINE Webhook
app.post('/webhook', async (req, res) => {
  const signature = req.headers['x-line-signature'];
  if (!signature || !verifySignature(req.rawBody, signature)) {
    console.warn('[Webhook] Invalid signature -- request rejected.');
    return res.status(401).json({ error: 'Invalid signature' });
  }

  res.sendStatus(200);

  const events = req.body.events ?? [];

  for (const event of events) {
    if (event.type !== 'message') continue;

    // Image: payment slip
    if (event.message?.type === 'image') {
      if (event.source?.type === 'user') continue;
      const groupId   = event.source?.groupId ?? event.source?.roomId;
      const messageId = event.message.id;
      console.log(`[Slip] Image in ${event.source?.type} ${(groupId ?? '').slice(0, 10)}`);
      (async () => {
        try {
          const slip = await readSlip(messageId);
          if (!slip.isValid) return;
          const peak = await processSlipPayment(slip.amount, slip.date);
          if (!peak.success) return;
          const amt = formatBaht(peak.amount);
          const msg = `\u0e44\u0e14\u0e49\u0e23\u0e31\u0e1a\u0e01\u0e32\u0e23\u0e0a\u0e33\u0e23\u0e30\u0e40\u0e07\u0e34\u0e19 ${amt} \u0e41\u0e25\u0e49\u0e27\u0e04\u0e48\u0e30 \u0e02\u0e2d\u0e1a\u0e04\u0e38\u0e13\u0e19\u0e30\u0e04\u0e48\u0e30!\n\uc785\uae08 \ud655\uc778\ub418\uc5c8\uc2b5\ub2c8\ub2e4 ${amt} \uac10\uc0ac\ud569\ub2c8\ub2e4!`;
          if (groupId) await pushText(groupId, msg);
        } catch (err) {
          console.error('[Slip] Error:', err.message);
        }
      })();
      continue;
    }

    // Text: translation + Lark buffering
    if (event.message?.type !== 'text') continue;

    const replyToken = event.replyToken;
    const msgText    = event.message.text?.trim();
    const timestamp  = new Date(event.timestamp).toISOString();

    if (!msgText) continue;

    // Translate (bidirectional: TH->KR, KR->TH, EN->TH)
    const result     = await translateAll(msgText);
    const inBizHours = isBusinessHours();

    const replies = [];
    if (result?.kr) {
      replies.push({ type: 'text', text: 'KR: ' + result.kr });
      console.log('[Translate] TH->KR: "' + msgText.slice(0, 30) + '"');
    } else if (result?.th) {
      replies.push({ type: 'text', text: result.th });
      console.log('[Translate] ->TH: "' + msgText.slice(0, 30) + '"');
    }
    if (!inBizHours) {
      replies.push({ type: 'text', text: OOO_MESSAGE });
    }
    if (replies.length > 0) {
      await replyMessages(replyToken, replies);
    }

    if (inBizHours) {
      const senderName = await getSenderName(event);
      addMessage({ timestamp, senderName, text: msgText });
      console.log('[Webhook] Buffered from ' + senderName + ': "' + msgText.slice(0, 40) + '"');
    }
  }
});

// Setup webhook helper
app.get('/setup-webhook', async (_req, res) => {
  try {
    const webhookUrl = 'https://line-to-lark-automation.onrender.com/webhook';
    const r = await axios.put(
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
  console.log('\n Server running on port ' + PORT);
  console.log('   Bangkok time : ' + getBangkokTime());
  console.log('   Business hrs : ' + (isBusinessHours() ? 'YES' : 'NO'));
  startCronJob();
  startKeepAlive();
});
