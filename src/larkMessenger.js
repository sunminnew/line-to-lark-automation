/**
 * larkMessenger.js
 * Three destination rooms:
 *   LARK_CHAT_ID    — 📣 Wisdom & Zenith9 – All Updates (main hub, hourly pipeline)
 *   ALERT_CHAT_ID   — 🚨 แจ้งเตือน – แชทค้าง (yellow/red stale alerts)
 *   SUMMARY_CHAT_ID — 📋 สรุปงาน – Daily Summary (morning/evening + keyword สรุป)
 *
 * Bot identity: อูจิน (우진) | Wisdom International
 */
require('dotenv').config();
const axios = require('axios');

const LARK_BASE    = 'https://open.larksuite.com/open-apis';
const APP_ID       = process.env.LARK_APP_ID     ?? 'cli_aab97d48c6789e15';
const APP_SECRET   = process.env.LARK_APP_SECRET ?? 'OBNRxnFahLxKUuPyYO05XbzrcDTxtasP';
const LARK_CHAT_ID    = process.env.LARK_CHAT_ID    ?? 'oc_626fd292d23700898b50fd059c1798ed';
const ALERT_CHAT_ID   = process.env.ALERT_CHAT_ID   ?? 'oc_339458a388434ff81afde59342b511b3';
const SUMMARY_CHAT_ID = process.env.SUMMARY_CHAT_ID ?? 'oc_a62e855cfd58229964b2d68b224288b8';

const UJIN_SIGNATURE = '🤖 อูจิน (우진) | Wisdom International';

let _token = null;
let _tokenExpiry = 0;

async function getToken() {
  if (_token && Date.now() < _tokenExpiry) return _token;
  const res = await axios.post(`${LARK_BASE}/auth/v3/tenant_access_token/internal`, {
    app_id: APP_ID, app_secret: APP_SECRET,
  });
  _token = res.data.tenant_access_token;
  _tokenExpiry = Date.now() + (res.data.expire - 60) * 1000;
  return _token;
}

/**
 * Send plain text to the MAIN hub group (📣 All Updates)
 */
async function sendToLarkGroup(text, chatId = LARK_CHAT_ID) {
  const token = await getToken();
  const res = await axios.post(
    `${LARK_BASE}/im/v1/messages?receive_id_type=chat_id`,
    { receive_id: chatId, msg_type: 'text', content: JSON.stringify({ text }) },
    { headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` } }
  );
  return res.data.data?.message_id;
}

/**
 * Send a colored interactive card.
 * @param {string} title - Card header text
 * @param {string} body  - Markdown body
 * @param {'yellow'|'red'|'green'|'blue'|'orange'} level
 * @param {string} chatId - Target chat (defaults to ALERT room)
 */
async function sendAlertCard(title, body, level = 'yellow', chatId = ALERT_CHAT_ID) {
  const token = await getToken();
  const LEVEL_COLORS = { yellow:'yellow', red:'red', green:'green', blue:'blue', orange:'orange' };
  const card = {
    config: { wide_screen_mode: true },
    header: {
      title:    { tag: 'plain_text', content: title },
      template: LEVEL_COLORS[level] ?? 'yellow',
    },
    elements: [
      {
        tag:  'div',
        text: { tag: 'lark_md', content: body },
      },
      {
        tag: 'note',
        elements: [
          { tag: 'plain_text', content: UJIN_SIGNATURE },
          { tag: 'plain_text', content: `🕐 ${new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' })}` },
        ],
      },
    ],
  };
  const res = await axios.post(
    `${LARK_BASE}/im/v1/messages?receive_id_type=chat_id`,
    { receive_id: chatId, msg_type: 'interactive', content: JSON.stringify(card) },
    { headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` } }
  );
  return res.data.data?.message_id;
}

/**
 * Send a summary card to the SUMMARY room (📋 สรุปงาน)
 */
async function sendSummaryCard(title, body) {
  return sendAlertCard(title, body, 'blue', SUMMARY_CHAT_ID);
}

/**
 * Send a stale-chat alert to the ALERT room (🚨 แจ้งเตือน)
 * level = 'yellow' or 'red'
 */
async function sendStaleAlert(title, body, level = 'yellow') {
  return sendAlertCard(title, body, level, ALERT_CHAT_ID);
}

async function listBotChats() {
  const token = await getToken();
  const res = await axios.get(
    `${LARK_BASE}/im/v1/chats?page_size=20`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  return res.data.data?.items ?? [];
}

module.exports = {
  sendToLarkGroup,
  sendAlertCard,
  sendSummaryCard,
  sendStaleAlert,
  listBotChats,
  LARK_CHAT_ID,
  ALERT_CHAT_ID,
  SUMMARY_CHAT_ID,
};
