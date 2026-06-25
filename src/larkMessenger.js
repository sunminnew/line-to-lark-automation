/**
 * larkMessenger.js
 * Sends text messages and colored alert cards to a Lark group chat.
 */

const axios = require('axios');

const LARK_BASE    = 'https://open.larksuite.com/open-apis';
const APP_ID       = process.env.LARK_APP_ID;
const APP_SECRET   = process.env.LARK_APP_SECRET;
const LARK_CHAT_ID = process.env.LARK_CHAT_ID;

let tokenCache = { token: null, expiresAt: 0 };

async function getTenantToken() {
  const now = Date.now();
  if (tokenCache.token && now < tokenCache.expiresAt) return tokenCache.token;
  const res = await axios.post(`${LARK_BASE}/auth/v3/tenant_access_token/internal`, {
    app_id: APP_ID, app_secret: APP_SECRET,
  });
  if (res.data.code !== 0) throw new Error(`[Lark Auth] ${JSON.stringify(res.data)}`);
  tokenCache = { token: res.data.tenant_access_token, expiresAt: now + (res.data.expire - 60) * 1000 };
  return tokenCache.token;
}

/**
 * Send a plain-text message to the configured Lark group.
 */
async function sendToLarkGroup(text) {
  if (!LARK_CHAT_ID) { console.error('[LarkMsg] LARK_CHAT_ID not set'); return null; }
  try {
    const token = await getTenantToken();
    const res = await axios.post(
      `${LARK_BASE}/im/v1/messages?receive_id_type=chat_id`,
      { receive_id: LARK_CHAT_ID, msg_type: 'text', content: JSON.stringify({ text }) },
      { headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` } }
    );
    if (res.data.code !== 0) throw new Error(JSON.stringify(res.data));
    const msgId = res.data.data?.message_id;
    console.log(`[LarkMsg] ✅ Text sent (id: ${msgId})`);
    return msgId;
  } catch (err) {
    console.error('[LarkMsg] Send failed:', err.response?.data ?? err.message);
    return null;
  }
}

/**
 * Send a colored interactive card alert to the Lark group.
 * @param {string} title  Card header text
 * @param {string} body   Card body (supports Lark markdown)
 * @param {'yellow'|'red'|'green'} level  Header color
 */
async function sendAlertCard(title, body, level = 'yellow') {
  if (!LARK_CHAT_ID) { console.error('[LarkMsg] LARK_CHAT_ID not set'); return null; }
  try {
    const token = await getTenantToken();
    const templateMap = { yellow: 'yellow', red: 'red', green: 'green', blue: 'blue' };
    const card = {
      config: { wide_screen_mode: true },
      header: { title: { tag: 'plain_text', content: title }, template: templateMap[level] ?? 'yellow' },
      elements: [{ tag: 'div', text: { tag: 'lark_md', content: body } }],
    };
    const res = await axios.post(
      `${LARK_BASE}/im/v1/messages?receive_id_type=chat_id`,
      { receive_id: LARK_CHAT_ID, msg_type: 'interactive', content: JSON.stringify(card) },
      { headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` } }
    );
    if (res.data.code !== 0) throw new Error(JSON.stringify(res.data));
    const msgId = res.data.data?.message_id;
    console.log(`[LarkMsg] ✅ Card sent [${level}] (id: ${msgId})`);
    return msgId;
  } catch (err) {
    console.error('[LarkMsg] Card failed:', err.response?.data ?? err.message);
    return null;
  }
}

async function listBotChats() {
  try {
    const token = await getTenantToken();
    const res = await axios.get(`${LARK_BASE}/im/v1/chats`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    return res.data.data?.items ?? [];
  } catch (err) {
    console.error('[LarkMsg] List chats failed:', err.response?.data ?? err.message);
    return [];
  }
}

module.exports = { sendToLarkGroup, sendAlertCard, listBotChats };
