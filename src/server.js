/**
 * server.js
 * Express webhook server — LINE Thai↔Korean bidirectional translation.
 * Group/room chats only; 1-on-1 private chats are skipped silently.
 */

require('dotenv').config();

const express = require('express');
const axios   = require('axios');
const { isBusinessHours, getBangkokTime } = require('./timeRouter');
const {
  verifySignature,
  translateAll,
  replyMessages,
  checkBotInfo,
} = require('./lineHandler');

const app        = express();
const PORT       = process.env.PORT ?? 3000;
const WEBHOOK_URL = 'https://line-to-lark-automation.onrender.com/webhook';
const DEBOUNCE_MS = 500;

// ── In-memory log capture ──────────────────────────────────────────────────────
const LOG_LINES     = [];
const LOG_LISTENERS = new Set();
const _log   = console.log.bind(console);
const _error = console.error.bind(console);
const _warn  = console.warn.bind(console);
function _cap(level, args) {
  const line = `[${new Date().toISOString()}] ${level} ${args.map(a => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ')}`;
  LOG_LINES.push(line);
  if (LOG_LINES.length > 300) LOG_LINES.shift();
  LOG_LISTENERS.forEach(r => r.write(`data: ${JSON.stringify(line)}\n\n`));
}
console.log   = (...a) => { _log(...a);   _cap('LOG',   a); };
console.error = (...a) => { _error(...a); _cap('ERROR', a); };
console.warn  = (...a) => { _warn(...a);  _cap('WARN',  a); };

// ── Body parsing ───────────────────────────────────────────────────────────────
app.use(express.json({ verify: (req, _res, buf) => { req.rawBody = buf; } }));

// ── Debounce state ─────────────────────────────────────────────────────────────
const msgBuf = new Map();

function scheduleTranslation(sourceId, text, replyToken, eventTimestamp) {
  if (!msgBuf.has(sourceId)) {
    msgBuf.set(sourceId, { texts: [], token: null, ts: null, timer: null });
  }
  const buf = msgBuf.get(sourceId);
  buf.texts.push(text);
  buf.token = replyToken;
  buf.ts    = buf.ts || eventTimestamp;
  clearTimeout(buf.timer);
  buf.timer = setTimeout(async () => {
    const { texts, token, ts } = buf;
    msgBuf.delete(sourceId);
    const combined    = texts.join('\n');
    const tokenBudget = 27000 - (Date.now() - ts);
    if (tokenBudget < 3000) { console.log('[TR] token budget exhausted, skip'); return; }
    try {
      const replyAge = Date.now() - ts;
      console.log(`[TR] reply attempt: age=${replyAge}ms tok=${token ? token.slice(0, 12) : 'NULL'}`);
      const tr = await translateAll(combined);
      const replies = [];
      if (tr && tr.kr) replies.push({ type: 'text', text: 'KR: ' + tr.kr });
      if (tr && tr.th) replies.push({ type: 'text', text: 'TH: ' + tr.th });
      if (!replies.length) { console.log('[TR] no translation output, skip'); return; }
      replyMessages(token, replies.slice(0, 5)).catch(async (replyErr) => {
        const status = replyErr.response ? replyErr.response.status : replyErr.message;
        console.log(`[LINE] Reply failed (${status}) — push fallback to ${sourceId.slice(0, 10)}`);
        await axios.post(
          'https://api.line.me/v2/bot/message/push',
          { to: sourceId, messages: replies.slice(0, 5) },
          { headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}` } }
        )
          .then(() => console.log('[LINE] Push ok ->', sourceId.slice(0, 10)))
          .catch(e => console.error('[LINE] Push failed HTTP', e.response ? e.response.status : '?', ':', JSON.stringify(e.response ? e.response.data : e.message)));
      });
    } catch (e) { console.error('[TR] silent-fail:', e.message); }
  }, DEBOUNCE_MS);
}

// ── Diagnostic endpoints ───────────────────────────────────────────────────────

app.get('/', (_req, res) => {
  res.json({ status: 'ok', bangkokTime: getBangkokTime(), businessHours: isBusinessHours() });
});

app.get('/logs', (_req, res) => {
  res.setHeader('Content-Type', 'text/html');
  res.send('<!DOCTYPE html><html><head><title>Logs</title><meta charset="utf-8">' +
    '<style>body{background:#111;color:#0f0;font-family:monospace;font-size:13px;padding:16px}' +
    'pre{white-space:pre-wrap;word-break:break-all}</style></head><body>' +
    '<h3>Last ' + LOG_LINES.length + ' log lines</h3>' +
    '<pre>' + LOG_LINES.map(l => l.replace(/</g, '&lt;')).join('\n') + '</pre>' +
    '<script>setTimeout(()=>location.reload(),8000)</script></body></html>');
});

app.get('/logs/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.flushHeaders();
  for (const lb of LOG_LINES) res.write(`data: ${JSON.stringify(lb)}\n\n`);
  LOG_LISTENERS.add(res);
  req.on('close', () => { LOG_LISTENERS.delete(res); });
});

app.get('/check-line', async (_req, res) => {
  try {
    const result = await checkBotInfo();
    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/check-webhook', async (_req, res) => {
  try {
    const r = await axios.get('https://api.line.me/v2/bot/channel/webhook/endpoint',
      { headers: { Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}` } });
    res.json({ current: r.data, expected: WEBHOOK_URL, match: r.data.endpoint === WEBHOOK_URL });
  } catch (err) { res.status(500).json({ error: err.response ? err.response.data : err.message }); }
});

app.post('/setup-webhook', async (_req, res) => {
  try {
    const r = await axios.put(
      'https://api.line.me/v2/bot/channel/webhook/endpoint',
      { webhookEndpointUrl: WEBHOOK_URL },
      { headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}` } }
    );
    res.json({ set: WEBHOOK_URL, lineResponse: r.data });
  } catch (err) { res.status(500).json({ error: err.response ? err.response.data : err.message }); }
});

app.get('/quota', async (_req, res) => {
  try {
    const [q, c] = await Promise.all([
      axios.get('https://api.line.me/v2/bot/message/quota',
        { headers: { Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}` } }),
      axios.get('https://api.line.me/v2/bot/message/quota/consumption',
        { headers: { Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}` } }),
    ]);
    res.json({ quota: q.data, consumption: c.data });
  } catch (err) { res.status(500).json({ error: err.response ? err.response.data : err.message }); }
});

app.post('/test-push', async (req, res) => {
  const { to, text } = req.body;
  if (!to) return res.status(400).json({ error: 'to required' });
  try {
    await axios.post(
      'https://api.line.me/v2/bot/message/push',
      { to, messages: [{ type: 'text', text: text || 'ทดสอบ push' }] },
      { headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}` } }
    );
    res.json({ ok: true, to });
  } catch (err) {
    res.status(500).json({ error: err.response ? err.response.data : err.message, status: err.response ? err.response.status : null });
  }
});

app.post('/trigger', async (_req, res) => {
  try {
    const { runPipeline } = require('./cronJob');
    await runPipeline();
    res.json({ status: 'pipeline executed' });
  } catch (err) { res.json({ status: 'ok', note: err.message }); }
});

// ── LINE Webhook ───────────────────────────────────────────────────────────────
app.post('/webhook', async (req, res) => {
  const signature = req.headers['x-line-signature'];
  if (!signature || !verifySignature(req.rawBody, signature)) {
    return res.status(401).json({ error: 'Invalid signature' });
  }
  res.sendStatus(200);

  for (const event of (req.body.events ?? [])) {
    if (event.type !== 'message' || event.message?.type !== 'text') continue;
    // Skip 1-on-1 private chats
    if (event.source?.type === 'user') continue;
    const sourceId = event.source?.groupId ?? event.source?.roomId ?? 'unknown';
    const text = event.message.text?.trim();
    if (!text) continue;
    // Skip stale events (>20 s old)
    const eventAge = Date.now() - (event.timestamp || 0);
    if (eventAge > 20000) {
      console.log(`[webhook] stale skip ${Math.round(eventAge / 1000)}s src=${event.source?.type} id=${sourceId.slice(0, 8)}`);
      continue;
    }
    console.log(`[webhook] src=${event.source?.type} id=${sourceId.slice(0, 10)} age=${eventAge}ms tok=${event.replyToken ? event.replyToken.slice(0, 12) : 'NULL'}`);
    scheduleTranslation(sourceId, text, event.replyToken, event.timestamp);
  }
});

// ── LINE OAuth token auto-generation ──────────────────────────────────────────
// If LINE_CHANNEL_ID is set, generate a fresh channel access token automatically.
// This avoids the need to manually copy long-lived tokens from the Developer Console.
async function refreshLineToken() {
  const channelId     = process.env.LINE_CHANNEL_ID;
  const channelSecret = process.env.LINE_CHANNEL_SECRET;
  if (!channelId || !channelSecret) return;
  try {
    const r = await axios.post(
      'https://api.line.me/v2/oauth/accessToken',
      `grant_type=client_credentials&client_id=${channelId}&client_secret=${channelSecret}`,
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );
    process.env.LINE_CHANNEL_ACCESS_TOKEN = r.data.access_token;
    const expiresIn = r.data.expires_in || 2592000; // default 30 days
    console.log(`[LINE] OAuth token refreshed — expires in ${Math.round(expiresIn / 86400)}d`);
    // Auto-refresh at 90% of lifetime
    setTimeout(refreshLineToken, expiresIn * 0.9 * 1000);
  } catch (e) {
    console.error('[LINE] OAuth token refresh failed:', e.response ? JSON.stringify(e.response.data) : e.message);
    // Retry in 5 minutes
    setTimeout(refreshLineToken, 5 * 60 * 1000);
  }
}

// ── Start ──────────────────────────────────────────────────────────────────────
app.listen(PORT, async () => {
  console.log(`[start] Server on port ${PORT}`);
  console.log(`[start] Bangkok: ${getBangkokTime()}, BusinessHours: ${isBusinessHours()}`);
  await refreshLineToken(); // generate Wisdom Consulting token before anything else
  try { require('./cronJob').startCronJob(); console.log('[start] cronJob started'); } catch (e) { console.log('[start] cronJob skip:', e.message); }
  try { require('./keepAlive').startKeepAlive(); console.log('[start] keepAlive started'); } catch (e) { console.log('[start] keepAlive skip:', e.message); }
});
