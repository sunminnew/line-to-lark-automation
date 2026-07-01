/**
 * larkMessenger.js
 * Sends messages to Lark group chats via the IM v1 API.
 *
 * Room env vars:
 *   LARK_CHAT_ID         -- Hub room (main, receives hourly pipeline summaries)
 *   LARK_ALERT_CHAT_ID   -- Alert room (stale-chat / join / leave alerts)
 *   LARK_SUMMARY_CHAT_ID -- Summary room (AI Urgent, morning/evening summaries)
 *
 * Auth: LARK_APP_ID / LARK_APP_SECRET
 */

const axios = require('axios');

const LARK_BASE            = 'https://open.larksuite.com/open-apis';
const APP_ID               = process.env.LARK_APP_ID;
const APP_SECRET           = process.env.LARK_APP_SECRET;
const LARK_CHAT_ID         = process.env.LARK_CHAT_ID;
const LARK_ALERT_CHAT_ID   = process.env.LARK_ALERT_CHAT_ID;
const LARK_SUMMARY_CHAT_ID = process.env.LARK_SUMMARY_CHAT_ID;

// ── Token cache ────────────────────────────────────────────────────────────
let tokenCache = { token: null, expiresAt: 0 };

async function getTenantToken() {
  const now = Date.now();
  if (tokenCache.token && now < tokenCache.expiresAt) return tokenCache.token;
  const res = await axios.post(`${LARK_BASE}/auth/v3/tenant_access_token/internal`, {
    app_id: APP_ID, app_secret: APP_SECRET,
  });
  if (res.data.code !== 0) throw new Error(`[Lark Auth] ${JSON.stringify(res.data)}`);
  tokenCache = {
    token:     res.data.tenant_access_token,
    expiresAt: now + (res.data.expire - 60) * 1000,
  };
  console.log('[LarkMsg] Token refreshed.');
  return tokenCache.token;
}

// ── Core send ─────────────────────────────────────────────────────────────
async function sendMsg(chatId, text) {
  if (!chatId) { console.error('[LarkMsg] chatId not set — cannot send.'); return null; }
  try {
    const token = await getTenantToken();
    const res = await axios.post(
      `${LARK_BASE}/im/v1/messages?receive_id_type=chat_id`,
      { receive_id: chatId, msg_type: 'text', content: JSON.stringify({ text }) },
      { headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` } }
    );
    if (res.data.code !== 0) throw new Error(JSON.stringify(res.data));
    const msgId = res.data.data?.message_id;
    console.log(`[LarkMsg] ✓ sent to ${chatId} (id: ${msgId})`);
    return msgId;
  } catch (err) {
    console.error('[LarkMsg] Send failed:', err.response?.data ?? err.message);
    return null;
  }
}

/**
 * Send plain text to the hub room (📣 all updates / hourly pipeline).
 */
async function sendToLarkGroup(text) {
  return sendMsg(LARK_CHAT_ID, text);
}

/**
 * Send a summary card to the summary room (📋).
 * Falls back to hub room if LARK_SUMMARY_CHAT_ID is not set.
 * @param {string} title  Header line
 * @param {string} body   Body content
 */
async function sendSummaryCard(title, body) {
  const text = `${title}\n\n${body}`;
  return sendMsg(LARK_SUMMARY_CHAT_ID || LARK_CHAT_ID, text);
}

/**
 * Send a stale-chat alert to the alert room (🚨).
 * @param {string} title
 * @param {string} body
 * @param {'red'|'yellow'} color
 */
async function sendStaleAlert(title, body, color) {
  const icon = color === 'red' ? '🔴' : '🟡';
  const text = `${icon} ${title}\n\n${body}`;
  return sendMsg(LARK_ALERT_CHAT_ID || LARK_CHAT_ID, text);
}

/**
 * Send a bot join/leave alert card to the alert room (🚨).
 * @param {string} title
 * @param {string} body
 * @param {'green'|'red'|'yellow'} color
 */
async function sendAlertCard(title, body, color) {
  const icon = color === 'green' ? '🟢' : color === 'red' ? '🔴' : '🟡';
  const text = `${icon} ${title}\n\n${body}`;
  return sendMsg(LARK_ALERT_CHAT_ID || LARK_CHAT_ID, text);
}

/**
 * List all group chats the bot is in — useful for finding LARK_*_CHAT_ID values.
 */
async function listBotChats() {
  try {
    const token = await getTenantToken();
    const res = await axios.get(`${LARK_BASE}/im/v1/chats?member_id_type=open_id`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    return res.data.data?.items ?? [];
  } catch (err) {
    console.error('[LarkMsg] List chats failed:', err.response?.data ?? err.message);
    return [];
  }
}

module.exports = { sendToLarkGroup, sendSummaryCard, sendStaleAlert, sendAlertCard, listBotChats };
