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
 *   - /status endpoint: real-time monitoring dashboard feed
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
const { addGroup }                       = require('./groupStore');
const { readSlip }                  = require('./slipReader');
const { processSlipPayment }        = require('./peakHandler');

const app  = express();
const PORT = process.env.PORT ?? 3000;

// -- In-memory stats ----------------------------------------------------------
const stats = {
  startTime: Date.now(),
  translate: { thKr: 0, toTh: 0, fail: 0, lastAt: null },
  slips:     { detected: 0, valid: 0, paid: 0, lastAt: null },
  ooo:       0,
  events:    [],   // raw ms timestamps, last 60 min (for minutely chart)
  recent:    [],   // last 30 events for activity feed
};

function recordEvent(type, preview) {
  const now = Date.now();
  const cutoff = now - 3_600_000;
  stats.events = stats.events.filter(t => t >= cutoff);
  stats.events.push(now);
  stats.recent.unshift({ t: now, type, preview: String(preview || '').slice(0, 50) });
  if (stats.recent.length > 30) stats.recent.pop();
}

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

// -- Status / monitoring endpoint ---------------------------------------------
app.get('/status', (_req, res) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  const now = Date.now();
  // Minutely counts for last 30 minutes (oldest->newest)
  const minutely = [];
  for (let i = 29; i >= 0; i--) {
    const s = now - (i + 1) * 60_000;
    const e = now - i * 60_000;
    minutely.push(stats.events.filter(t => t >= s && t < e).length);
  }
  res.json({
    alive: true,
    uptimeSec: Math.floor((now - stats.startTime) / 1000),
    bangkokTime: getBangkokTime(),
    businessHours: isBusinessHours(),
    translate: {
      ...stats.translate,
      secsSinceLast: stats.translate.lastAt
        ? Math.floor((now - stats.translate.lastAt) / 1000)
        : null,
    },
    slips: stats.slips,
    ooo: stats.ooo,
    minutely,
    recent: stats.recent.slice(0, 20),
  });
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
  return '฿' + Number(amount).toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
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
    // Register group automatically    if (event.source?.groupId) addGroup(event.source.groupId);
        if (event.source?.roomId)  addGroup(event.source.roomId);
        if (event.type !== 'message') continue;

    // Image: payment slip
    if (event.message?.type === 'image') {
      if (event.source?.type === 'user') continue;
      const groupId   = event.source?.groupId ?? event.source?.roomId;
      const messageId = event.message.id;
      console.log(`[Slip] Image in ${event.source?.type} ${(groupId ?? '').slice(0, 10)}`);
      stats.slips.detected++;
      recordEvent('slip_detected', 'รูป slip');
      (async () => {
        try {
          const slip = await readSlip(messageId);
          if (!slip.isValid) return;
          stats.slips.valid++;
          recordEvent('slip_valid', formatBaht(slip.amount));
          const peak = await processSlipPayment(slip.amount, slip.date);
          if (!peak.success) return;
          stats.slips.paid++;
          stats.slips.lastAt = Date.now();
          const amt = formatBaht(peak.amount);
          recordEvent('slip_paid', amt);
          const msg = `ได้รับการชำระเงิน ${amt} แล้วค่ะ ขอบคุณนะค่ะ!\n입금 확인되었습니다 ${amt} 감사합니다!`;
          if (groupId) await pushText(groupId, msg);
        } catch (err) {
          console.error('[Slip] Error:', err.message);
        }
      })();
      continue;
    }

    // Text: translation + Lark buffering
    if (event.message?.type !== 'text') continue;
    // Skip private (1-on-1) chats
    if (event.source?.type === 'user') continue;

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
      stats.translate.thKr++;
      stats.translate.lastAt = Date.now();
      recordEvent('th_kr', msgText.slice(0, 40));
      console.log('[Translate] TH->KR: "' + msgText.slice(0, 30) + '"');
    } else if (result?.th) {
      replies.push({ type: 'text', text: result.th });
      stats.translate.toTh++;
      stats.translate.lastAt = Date.now();
      recordEvent('to_th', msgText.slice(0, 40));
      console.log('[Translate] ->TH: "' + msgText.slice(0, 30) + '"');
    } else {
      stats.translate.fail++;
      recordEvent('no_trans', msgText.slice(0, 30));
    }
    if (!inBizHours) {
      replies.push({ type: 'text', text: OOO_MESSAGE });
      stats.ooo++;
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
