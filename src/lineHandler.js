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

// Strip non-target characters to remove garbage from LLM output
function cleanKorean(t) {
  return t.replace(/[^가-힯ᄀ-ᇿ㄰-㆏sd.,!?~-:;'"()/]/g, '').trim();
}
function cleanThai(t) {
  return t.replace(/[^฀-๿sd.,!?~-:;'"()/]/g, '').trim();
}

async function translate(text) {
  if (THAI_REGEX.test(text)) {
    console.log('[Translate] Thai detected → translating to Korean');
    const raw = await groqTranslate(
      text,
      'Translate this Thai text to Korean. Output ONLY Korean Hangul (한글). No Russian, no Japanese, no Chinese, no English, no romanization, no explanation whatsoever. ONLY Korean Hangul characters.'
    );
    return raw ? (cleanKorean(raw) || raw) : null;
  }
  if (KOREAN_REGEX.test(text)) {
    console.log('[Translate] Korean detected → translating to Thai');
    const raw = await groqTranslate(
      text,
      'Translate this Korean text to Thai. Output ONLY Thai script (ภาษาไทย). No Russian, no Japanese, no Korean, no English, no romanization, no explanation whatsoever. ONLY Thai script characters.'
    );
    return raw ? (cleanThai(raw) || raw) : null;
  }
  if (ENGLISH_REGEX.test(text) && !THAI_REGEX.test(text) && !KOREAN_REGEX.test(text)) {
    console.log('[Translate] English detected → translating to Thai');
    const raw = await groqTranslate(
      text,
      'Translate this English text to Thai. Output ONLY Thai script (ภาษาไทย). No English, no romanization, no explanation. ONLY Thai script characters.'
    );
    return raw ? (cleanThai(raw) || raw) : null;
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
    console.log('[TR] T01 Groq th_to_kr');
    const kr = await groqTranslate(
      text,
      'You are a professional Thai-to-Korean translator. Translate the following Thai text into natural Korean. Output ONLY the Korean translation — no explanation, no romanization, no Thai text.'
    );
    if (kr) console.log('[TR] T01 ok dir=th_to_kr');
    return kr ? { kr, th: null } : null;
  }
  if (KOREAN_REGEX.test(text)) {
    console.log('[TR] T01 Groq kr_to_th');
    const th = await groqTranslate(
      text,
      'You are a professional Korean-to-Thai translator. Translate the following Korean text into natural Thai. Output ONLY the Thai translation — no explanation, no romanization, no Korean text.'
    );
    if (th) console.log('[TR] T01 ok dir=kr_to_th');
    return th ? { kr: null, th } : null;
  }
  return null; // not Thai or Korean — skip silently
}

module.exports = { verifySignature, translate, translateToKorean: translate, translateAll, replyMessages, replyOOO, getSenderName, checkBotInfo, OOO_MESSAGE };
