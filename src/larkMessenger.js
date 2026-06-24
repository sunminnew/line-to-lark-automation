/**
 * larkMessenger.js
 * Sends a text message to a Lark group chat via the IM v1 API.
 *
 * Required env vars:
 *   LARK_APP_ID      -- Bot App ID
 *   LARK_APP_SECRET  -- Bot App Secret
 *   LARK_CHAT_ID     -- Target group chat_id (e.g. "oc_xxxxxxxx")
 *
 * Lark IM docs:
 *   https://open.larksuite.com/document/uAjLw4CM/ukTMukTMukTM/im-v1/message/create
 */

const axios = require('axios');

const LARK_BASE    = 'https://open.larksuite.com/open-apis';
const APP_ID       = process.env.LARK_APP_ID;
const APP_SECRET   = process.env.LARK_APP_SECRET;
const LARK_CHAT_ID = process.env.LARK_CHAT_ID;

// Token cache (shared; same pattern as larkIntegration.js)
let tokenCache = { token: null, expiresAt: 0 };

async function getTenantToken() {
  const now = Date.now();
  if (tokenCache.token && now < tokenCache.expiresAt) return tokenCache.token;

  const res = await axios.post(`${LARK_BASE}/auth/v3/tenant_access_token/internal`, {
    app_id:     APP_ID,
    app_secret: APP_SECRET,
  });

  if (res.data.code !== 0) {
    throw new Error(`[Lark Auth] ${JSON.stringify(res.data)}`);
  }

  tokenCache = {
    token:     res.data.tenant_access_token,
    expiresAt: now + (res.data.expire - 60) * 1000,
  };
  console.log('[LarkMsg] Token refreshed.');
  return tokenCache.token;
}

/**
 * Send a plain-text message to the configured Lark group chat.
 * @param {string} text  Message body
 * @returns {Promise<string|null>}  Message ID or null on failure
 */
async function sendToLarkGroup(text) {
  if (!LARK_CHAT_ID) {
    console.error('[LarkMsg] LARK_CHAT_ID env var not set --- cannot send message.');
    return null;
  }

  try {
    const token = await getTenantToken();

    const res = await axios.post(
      `${LARK_BASE}/im/v1/messages?receive_id_type=chat_id`,
      {
        receive_id: LARK_CHAT_ID,
        msg_type:   'text',
        content:    JSON.stringify({ text }),
      },
      {
        headers: {
          'Content-Type': 'application/json',
          Authorization:  `Bearer ${token}`,
        },
      }
    );

    if (res.data.code !== 0) {
      throw new Error(JSON.stringify(res.data));
    }

    const msgId = res.data.data?.message_id;
    console.log(`[LarkMsg] Message sent (id: ${msgId})`);
    return msgId;

  } catch (err) {
    console.error('[LarkMsg] Send failed:', err.response?.data ?? err.message);
    return null;
  }
}

/**
 * List all group chats the bot is in -- useful for finding the right LARK_CHAT_ID.
 * Call GET /lark-chats on the server to see results.
 * @returns {Promise<Array>}
 */
async function listBotChats() {
  try {
    const token = await getTenantToken();
    const res = await axios.get(`${LARK_BASE}/im/v1/chats`, {
      headers: { Authorization: `Bearer ${token}` },
      params: { page_size: 100 },
    });
    console.log('[LarkMsg] /im/v1/chats raw response:', JSON.stringify(res.data));
    if (res.data.code !== 0) {
      console.error('[LarkMsg] API error:', res.data);
      return [];
    }
    return res.data.data?.items ?? [];
  } catch (err) {
    console.error('[LarkMsg] List chats failed:', err.response?.data ?? err.message);
    return [];
  }
}

module.exports = { sendToLarkGroup, listBotChats };
