/**
 * keepAlive.js
 * Pings the server every 5 minutes to prevent Render free-tier sleep.
 * Render spins down after ~15 min of inactivity — 5 min ping keeps it always warm.
 */
const axios = require('axios');

const PING_URL = process.env.RENDER_EXTERNAL_URL || 'https://line-to-lark-automation.onrender.com';
const INTERVAL_MS = 5 * 60 * 1000; // 5 minutes (was 10 — now tighter to prevent ANY sleep)

async function ping() {
  try {
    const r = await axios.get(PING_URL + '/', { timeout: 10000 });
    console.log('[KeepAlive] ping ok', r.status);
  } catch (e) {
    console.warn('[KeepAlive] ping failed:', e.message?.slice(0, 60));
    // Silent — don't crash the server over a failed ping
  }
}

function startKeepAlive() {
  // Ping immediately on start, then every 5 minutes
  ping();
  setInterval(ping, INTERVAL_MS);
  console.log('[KeepAlive] started — pinging every 5 min');
}

module.exports = { startKeepAlive };
