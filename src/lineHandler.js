/**
 * lineHandler.js
 * Handles LINE Webhook events, OOO auto-reply, and Thai→Korean translation.
 * Uses Google Gemini API (free tier).
 */

const axios = require('axios');
const crypto = require('crypto');

const LINE_API_BASE = 'https://api.line.me/v2/bot';
const ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

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
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`,
      {
        contents: [{ parts: [{ text: `You are a professional Thai-to-Korean translator. Translate the following Thai text to natural Korean. Reply with ONLY the Korean translation.

${text}` }] }],
        generationConfig: { temperature: 0.1, maxOutputTokens: 500 },
      },
      { headers: { 'Content-Type': 'application/json' } }
    );
    return res.data.candidates[0].content.parts[0].text.trim();
  } catch (err) {
    console.error('[Translate] Gemini error:', err.response?.data ?? err.message);
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
