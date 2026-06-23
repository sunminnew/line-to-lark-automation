/**
 * lineHandler.js
 * Handles LINE Webhook events, OOO auto-reply, and Thai→Korean translation.
 * Uses Groq API (free tier) with llama model.
 */

const axios = require('axios');
const crypto = require('crypto');

const LINE_API_BASE = 'https://api.line.me/v2/bot';
const ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET;
const GROQ_API_KEY = process.env.GROQ_API_KEY;

const OOO_MESSAGE =
  'สวัสดีค่า/ครับ ขณะนี้อยู่นอกเวลาทำการ (09.00-18.00 น.) ' +
  'ทางทีมงานได้รับข้อความของท่านแล้ว และจะรีบติดต่อกลับทันทีในเวลาทำการ ' +
  'ขอบพระคุณที่ไว้วางใจค่า/ครับ';

const THAI_REGEX = /[฀-๿]/;

function verifySignature(rawBody, signature) {
  const hmac = crypto.createHmac('SHA256', CHANNEL_SECRET);
  hmac.update(rawBody);
  return hmac.digest('base64') === signature;
}

async function translateToKorean(text) {
  if (!THAI_REGEX.test(text)) return null;
  try {
    const res = await axios.post(
      'https://api.groq.com/openai/v1/chat/completions',
      {
        model: 'llama-3.1-8b-instant',
        messages: [
          { role: 'system', content: 'You are a professional Thai-to-Korean translator. Translate the Thai text to natural Korean. Reply with ONLY the Korean translation.' },
          { role: 'user', content: text },
        ],
        temperature: 0.1,
        max_tokens: 500,
      },
      { headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${GROQ_API_KEY}` } }
    );
    return res.data.choices[0].message.content.trim();
  } catch (err) {
    console.error('[Translate] Groq error:', err.response?.data ?? err.message);
    return null;
  }
}

async function replyMessages(replyToken, messages) {
  try {
    await axios.post(
      `${LINE_API_BASE}/message/reply`,
      { replyToken, messages },
      { headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ACCESS_TOKEN}` } }
    );
  } catch (err) {
    console.error('[LINE] Reply failed:', err.response?.data ?? err.message);
  }
}

async function replyOOO(replyToken) {
  await replyMessages(replyToken, [{ type: 'text', text: OOO_MESSAGE }]);
  console.log('[LINE] OOO reply sent.');
}

async function getSenderName(event) {
  try {
    const { userId, groupId, roomId } = event.source;
    let url;
    if (groupId) url = `${LINE_API_BASE}/group/${groupId}/member/${userId}`;
    else if (roomId) url = `${LINE_API_BASE}/room/${roomId}/member/${userId}`;
    else url = `${LINE_API_BASE}/profile/${userId}`;
    const res = await axios.get(url, { headers: { Authorization: `Bearer ${ACCESS_TOKEN}` } });
    return res.data.displayName ?? userId;
  } catch {
    return event.source.userId ?? 'Unknown';
  }
}

module.exports = { verifySignature, translateToKorean, replyMessages, replyOOO, getSenderName, OOO_MESSAGE };
