/**
 * lineHandler.js
 * Handles LINE Webhook events and the OOO auto-reply.
 *
 * LINE Docs:
 *   Webhook events  → https://developers.line.biz/en/reference/messaging-api/#webhook-event-objects
 *   Reply message   → https://developers.line.biz/en/reference/messaging-api/#send-reply-message
 */

const axios = require('axios');
const crypto = require('crypto');

const LINE_API_BASE   = 'https://api.line.me/v2/bot';
const ACCESS_TOKEN    = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const CHANNEL_SECRET  = process.env.LINE_CHANNEL_SECRET;

const OOO_MESSAGE =
  'สวัสดีค่ะ/ครับ ขณะนี้อยู่นอกเวลาทำการ (09.00-18.00 น.) ' +
  'ทางทีมงานได้รับข้อความของท่านแล้ว และจะรีบติดต่อกลับทันทีในเวลาทำการ ' +
  'ขอบพระคุณที่ไว้วางใจค่ะ/ครับ';

// ── Signature verification ────────────────────────────────────────────────────

/**
 * Validates the X-Line-Signature header to prevent spoofed requests.
 * @param {Buffer} rawBody
 * @param {string} signature  — value of X-Line-Signature header
 * @returns {boolean}
 */
function verifySignature(rawBody, signature) {
  const hmac = crypto.createHmac('SHA256', CHANNEL_SECRET);
  hmac.update(rawBody);
  const digest = hmac.digest('base64');
  return digest === signature;
}

// ── Reply API ─────────────────────────────────────────────────────────────────

/**
 * Sends a text reply via the LINE Reply Message API.
 * @param {string} replyToken  — one-time token from the webhook event
 * @param {string} text
 */
async function replyOOO(replyToken, text = OOO_MESSAGE) {
  try {
    await axios.post(
      `${LINE_API_BASE}/message/reply`,
      {
        replyToken,
        messages: [{ type: 'text', text }],
      },
      {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${ACCESS_TOKEN}`,
        },
      }
    );
    console.log('[LINE] OOO reply sent.');
  } catch (err) {
    console.error('[LINE] Reply failed:', err.response?.data ?? err.message);
  }
}

// ── Event parser ──────────────────────────────────────────────────────────────

/**
 * Extracts the sender display name from a LINE message event.
 * In a group, the name lives inside event.source.userId — you need the
 * Profile API to resolve it, OR it is embedded in event.message if the
 * LINE Official Account is in the group with "Get Member Profile" enabled.
 *
 * Here we call the Group Member Profile endpoint.
 * @param {object} event  — LINE webhook event object
 * @returns {Promise<string>}
 */
async function getSenderName(event) {
  try {
    const { userId, groupId, roomId } = event.source;
    let url;
    if (groupId) {
      url = `${LINE_API_BASE}/group/${groupId}/member/${userId}`;
    } else if (roomId) {
      url = `${LINE_API_BASE}/room/${roomId}/member/${userId}`;
    } else {
      url = `${LINE_API_BASE}/profile/${userId}`;
    }
    const res = await axios.get(url, {
      headers: { Authorization: `Bearer ${ACCESS_TOKEN}` },
    });
    return res.data.displayName ?? userId;
  } catch {
    return event.source.userId ?? 'Unknown';
  }
}

module.exports = { verifySignature, replyOOO, getSenderName, OOO_MESSAGE };
