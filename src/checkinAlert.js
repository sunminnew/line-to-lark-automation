/**
 * checkinAlert.js
 * Receives a webhook from the AppSheet "WIZDOM ZENITH9 HR" bot every time an
 * employee checks in, and pushes a one-line notice to ONE LINE group only
 * (HR_GROUP_ID = "HR - zinith9"). That group is excluded from translation
 * and from scheduled greetings (see groupStore.isExcludedGroup).
 *
 * Auth: shared secret in header `x-webhook-secret` (or `?key=`), env CHECKIN_WEBHOOK_SECRET.
 */

const crypto = require('crypto');
const axios = require('axios');

// LINE group "HR - zinith9". Override with HR_GROUP_ID env if the group ever changes.
const DEFAULT_HR_GROUP_ID = 'Ce6c789004bf543455234dd166cae5d95';
const HR_GROUP_ID = () => (process.env.HR_GROUP_ID || DEFAULT_HR_GROUP_ID).trim();

function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

function buildText(body) {
  if (typeof body.text === 'string' && body.text.trim()) return body.text.trim();
  const name = body.employee || 'พนักงาน';
  const shift = body.shift ? ` (กะ ${body.shift})` : '';
  const status = body.status ? ` สถานะ ${body.status}` : '';
  return `เช็คอิน: ${name}${shift}${status}`;
}

async function handleCheckinAlert(req, res) {
  const secret = process.env.CHECKIN_WEBHOOK_SECRET;
  if (!secret) {
    console.error('[CheckinAlert] CHECKIN_WEBHOOK_SECRET is not set -- rejecting');
    return res.status(503).json({ error: 'not configured' });
  }
  const given = req.headers['x-webhook-secret'] || req.query.key || '';
  if (!given || !safeEqual(given, secret)) {
    console.warn('[CheckinAlert] bad secret -- rejected');
    return res.status(401).json({ error: 'unauthorized' });
  }

  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const text = buildText(body).slice(0, 1000);

  try {
    await axios.post(
      'https://api.line.me/v2/bot/message/push',
      { to: HR_GROUP_ID(), messages: [{ type: 'text', text }] },
      {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`,
        },
        timeout: 8000,
      }
    );
    console.log('[CheckinAlert] pushed to HR group:', text.slice(0, 60));
    return res.json({ ok: true });
  } catch (err) {
    console.error('[CheckinAlert] push failed:', err.response?.status ?? '?', JSON.stringify(err.response?.data ?? err.message));
    return res.status(502).json({ error: 'line push failed' });
  }
}

module.exports = { handleCheckinAlert, HR_GROUP_ID };
