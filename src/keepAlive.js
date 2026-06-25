/**
 * keepAlive.js
 * Pings the app's own root endpoint every 10 minutes so Render's free
 * plan never puts the service to sleep (sleep threshold = 15 min idle).
 *
 * Requires the env var RENDER_EXTERNAL_URL — Render injects this
 * automatically (e.g. https://line-to-lark-xxx.onrender.com).
 * Falls back to localhost during local dev (no-op effectively).
 */

const https = require('https');
const http  = require('http');
const cron  = require('node-cron');

const SELF_URL = process.env.RENDER_EXTERNAL_URL
  ? `${process.env.RENDER_EXTERNAL_URL}/`
  : `http://localhost:${process.env.PORT ?? 3000}/`;

function ping() {
  const lib = SELF_URL.startsWith('https') ? https : http;
  const req = lib.get(SELF_URL, (res) => {
    console.log(`[KeepAlive] ✅ Pinged ${SELF_URL} → ${res.statusCode}`);
    res.resume(); // drain
  });
  req.on('error', (err) => {
    console.warn(`[KeepAlive] ⚠️  Ping failed: ${err.message} — retrying in 1 min`);
    // Retry once after 60 seconds
    setTimeout(ping, 60_000);
  });
  req.setTimeout(15_000, () => {
    console.warn('[KeepAlive] ⏱️  Ping timed out — retrying in 1 min');
    req.destroy();
    setTimeout(ping, 60_000);
  });
}

/**
 * Schedule a ping every 10 minutes (well inside the 15-min idle threshold).
 * Also ping immediately on startup so the first cron tick is never the first ping.
 */
function startKeepAlive() {
  if (!process.env.RENDER_EXTERNAL_URL) {
    console.log('[KeepAlive] No RENDER_EXTERNAL_URL — skipping (local dev mode).');
    return;
  }
  // Immediate ping on startup
  ping();
  // Then every 10 minutes
  cron.schedule('*/10 * * * *', ping, { timezone: 'Asia/Bangkok' });
  console.log(`[KeepAlive] 🏓 Pinging ${SELF_URL} every 10 min to prevent free-plan sleep.`);
}

module.exports = { startKeepAlive };
