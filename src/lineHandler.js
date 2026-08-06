/**
 * lineHandler.js
 * Bidirectional translation: Thai↔Korean via Groq API (free tier).
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

const THAI_REGEX   = /[\u0E00-\u0E7F]/;
const KOREAN_REGEX = /[\uAC00-\uD7AF\u1100-\u11FF\u3130-\u318F]/;
const ENGLISH_REGEX = /[a-zA-Z]/;

function verifySignature(rawBody, signature) {
  const hmac = crypto.createHmac('SHA256', CHANNEL_SECRET);
  hmac.update(rawBody);
  return hmac.digest('base64') === signature;
}

async function groqTranslate(text, systemPrompt) {
  try {
    const res = await axios.post(
      'https://api.groq.com/openai/v1/chat/completions',
      {
        model: 'llama-3.3-70b-versatile',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: text },
        ],
        temperature: 0.1,
        max_tokens: 500,
      },
      { headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + GROQ_API_KEY } }
    );
    return res.data.choices[0].message.content.trim();
  } catch (err) {
    console.error('[Translate] Groq error:', err.response?.data ?? err.message);
    return null;
  }
}

// Strip non-target characters — use charCode only to avoid string escaping bugs
function cleanKorean(t) {
  return t.split("").filter(function(c) {
    var n = c.charCodeAt(0);
    return (n >= 0xAC00 && n <= 0xD7AF) ||
           (n >= 0x1100 && n <= 0x11FF) ||
           (n >= 0x3130 && n <= 0x318F) ||
           (n >= 0x41   && n <= 0x5A)   ||
           (n >= 0x61   && n <= 0x7A)   ||
           n === 32 || n === 10 || n === 9 ||
           (n >= 0x30 && n <= 0x39);
  }).join("").trim();
}
function cleanThai(t) {
  return t.split("").filter(function(c) {
    var n = c.charCodeAt(0);
    return (n >= 0x0E00 && n <= 0x0E7F) ||
           (n >= 0x41   && n <= 0x5A)   ||
           (n >= 0x61   && n <= 0x7A)   ||
           n === 32 || n === 10 || n === 9 ||
           (n >= 0x30 && n <= 0x39);
  }).join("").trim();
}

var TRANSLATE_ONLY_RULE = "IMPORTANT: You are a TRANSLATION TOOL only. Do NOT answer questions. Do NOT add information. Do NOT interpret. ONLY translate the exact words written, nothing more.";

async function translate(text) {
  if (THAI_REGEX.test(text)) {
    console.log("[Translate] Thai detected → translating to Korean");
    var raw = await groqTranslate(
      text,
      TRANSLATE_ONLY_RULE + "\n\nTranslate this Thai text to Korean (\ud55c\uad6d\uc5b4). Output ONLY Korean Hangul (\ud55c\uae00). For proper nouns with no Korean equivalent, use English letters. No Russian, no Japanese, no Chinese, no Thai script, no romanization, no explanation."
    );
    if (!raw) return null;
    var cleaned = cleanKorean(raw);
    return cleaned.length > 0 ? cleaned : null;
  }
  if (KOREAN_REGEX.test(text)) {
    console.log("[Translate] Korean detected → translating to Thai");
    var raw = await groqTranslate(
      text,
      TRANSLATE_ONLY_RULE + "\n\nTranslate this Korean text to Thai (\u0e20\u0e32\u0e29\u0e32\u0e44\u0e17\u0e22). Output ONLY Thai script. For proper nouns with no Thai equivalent, use English letters. No Russian, no Japanese, no Korean script, no romanization, no explanation."
    );
    if (!raw) return null;
    var cleaned = cleanThai(raw);
    return cleaned.length > 0 ? cleaned : null;
  }
  if (ENGLISH_REGEX.test(text) && !THAI_REGEX.test(text) && !KOREAN_REGEX.test(text)) {
    console.log("[Translate] English detected → translating to Thai");
    var raw = await groqTranslate(
      text,
      TRANSLATE_ONLY_RULE + "\n\nTranslate this English text to Thai (\u0e20\u0e32\u0e29\u0e32\u0e44\u0e17\u0e22). Output ONLY Thai script. No English, no romanization, no explanation."
    );
    if (!raw) return null;
    var cleaned = cleanThai(raw);
    return cleaned.length > 0 ? cleaned : null;
  }
  return null;
}

async function replyMessages(replyToken, messages) {
  const isDummy = !replyToken || /^0+$/.test(replyToken);
  console.log('[LINE] tok:', replyToken ? replyToken.slice(0, 15) : 'NULL', 'len:', replyToken?.length ?? 0, isDummy ? 'DUMMY' : 'ok');
  if (isDummy) throw new Error('dummy reply token');
  try {
    await axios.post(
      LINE_API_BASE + '/message/reply',
      { replyToken, messages },
      { headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + ACCESS_TOKEN } }
    );
    console.log('[LINE] Reply ok');
  } catch (err) {
    console.error('[LINE] Reply failed (HTTP', err.response?.status, '):', err.response?.data ?? err.message);
    throw err; // re-throw → push fallback in server.js fires
  }
}

async function checkBotInfo() {
  try {
    const res = await axios.get(LINE_API_BASE + '/info', {
      headers: { Authorization: 'Bearer ' + ACCESS_TOKEN }
    });
    return { ok: true, data: res.data };
  } catch (err) {
    return { ok: false, status: err.response?.status, error: err.response?.data ?? err.message };
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
    if (groupId) url = LINE_API_BASE + '/group/' + groupId + '/member/' + userId;
    else if (roomId) url = LINE_API_BASE + '/room/' + roomId + '/member/' + userId;
    else url = LINE_API_BASE + '/profile/' + userId;
    const res = await axios.get(url, { headers: { Authorization: 'Bearer ' + ACCESS_TOKEN } });
    return res.data.displayName ?? userId;
  } catch {
    return event.source.userId ?? 'Unknown';
  }
}


// translateAll: returns { kr, th } — used by server.js scheduleTranslation
async function translateAll(text) {
  if (THAI_REGEX.test(text)) {
    console.log("[TR] T01 Groq th_to_kr");
    var raw = await groqTranslate(
      text,
      TRANSLATE_ONLY_RULE + "\n\nTranslate this Thai text to Korean (\uD55C\uAD6D\uC5B4). Output ONLY Korean Hangul (\uD55C\uAE00). For proper nouns with no Korean equivalent, use English letters. No Russian, no Japanese, no Chinese, no Thai script, no romanization, no explanation."
    );
    if (!raw) return null;
    var kr = cleanKorean(raw);
    if (!kr) return null;
    console.log("[TR] T01 ok dir=th_to_kr");
    return { kr, th: null };
  }
  if (KOREAN_REGEX.test(text)) {
    console.log("[TR] T01 Groq kr_to_th");
    var raw = await groqTranslate(
      text,
      TRANSLATE_ONLY_RULE + "\n\nTranslate this Korean text to Thai (\u0E20\u0E32\u0E29\u0E32\u0E44\u0E17\u0E22). Output ONLY Thai script. For proper nouns with no Thai equivalent, use English letters. No Russian, no Japanese, no Korean script, no romanization, no explanation."
    );
    if (!raw) return null;
    var th = cleanThai(raw);
    if (!th) return null;
    console.log("[TR] T01 ok dir=kr_to_th");
    return { kr: null, th };
  }
  if (ENGLISH_REGEX.test(text) && !THAI_REGEX.test(text) && !KOREAN_REGEX.test(text)) {
    console.log("[TR] T01 Groq en_to_th");
    var raw = await groqTranslate(
      text,
      TRANSLATE_ONLY_RULE + "\n\nTranslate this English text to Thai (\u0E20\u0E32\u0E29\u0E32\u0E44\u0E17\u0E22). Output ONLY Thai script. No English, no romanization, no explanation."
    );
    if (!raw) return null;
    var th = cleanThai(raw);
    if (!th) return null;
    console.log("[TR] T01 ok dir=en_to_th");
    return { kr: null, th };
  }
  return null;
}

module.exports = { verifySignature, translate, translateToKorean: translate, translateAll, replyMessages, replyOOO, getSenderName, checkBotInfo, OOO_MESSAGE };
