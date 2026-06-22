/**
 * keepAlive.js
 * Pings the app's own health endpoint every 14 minutes so Render's free
 * plan never puts the dyno to sleep (sleep threshold = 15 min idle).
 *
 * Requires the env var RENDER_EXTERNAL_URL to be set — Render injects this
 * automatically on all services (e.g. https://line-to-lark-xxx.onrender.com).
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
  lib.get(SELF_URL, (res) => {
    console.log(`[KeepAlive] Pinged ${SELF_URL} → ${res.statusCode}`);
  }).on('error', (err) => {
    console.warn(`[KeepAlive] Ping failed: ${err.message}`);
  });
}

/**
 * Schedule a ping every 14 minutes.
 * node-cron expression: "every 14 minutes" = "0,14,28,42,56 * * * *"
 */
function startKeepAlive() {
  if (!process.env.RENDER_EXTERNAL_URL) {
    console.log('[KeepAlive] No RENDER_EXTERNAL_URL — skipping (local dev mode).');
    return;
  }
  cron.schedule('*/14 * * * *', ping);
  console.log(`[KeepAlive] Pinging ${SELF_URL} every 14 min to prevent free-plan sleep.`);
}

module.exports = { startKeepAlive };
