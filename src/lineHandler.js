/**
 * lineHandler.js
 * Bidirectional translation: Thai↔Korean (and English→Thai) via Gemini + Groq fallback.
 */
const axios = require('axios');
const crypto = require('crypto');

const LINE_API_BASE  = 'https://api.line.me/v2/bot';
const CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET;
const GROQ_API_KEY   = process.env.GROQ_API_KEY;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// Read token dynamically so server.js can refresh it at runtime
function getToken() { return process.env.LINE_CHANNEL_ACCESS_TOKEN; }

// Groq model fallback chain — first working model wins (2026 active models)
const GROQ_MODELS = [
  'openai/gpt-oss-20b',
];

const OOO_MESSAGE =
  'สวัสดีค่า/ครับ ขณะนี้อยู่นอกเวลาทำการ (09.00-18.00 น.) ' +
  'ทางทีมงานได้รับข้อความของท่านแล้ว และจะรีบติดต่อกลับทันทีในเวลาทำการ ' +
  'ขอบพระคุณที่ไว้วางใจค่า/ครับ';

const THAI_REGEX    = /[฀-๿]/;
const KOREAN_REGEX  = /[가-힯ᄀ-ᇿ㄰-㆏]/;
const ENGLISH_REGEX = /[a-zA-Z]/;

function verifySignature(rawBody, signature) {
  const hmac = crypto.createHmac('SHA256', CHANNEL_SECRET);
  hmac.update(rawBody);
  return hmac.digest('base64') === signature;
}

// ── Output cleaners ────────────────────────────────────────────────────────────
function cleanKorean(t) {
  return t.split('').filter(function(c) {
    var n = c.charCodeAt(0);
    return (n >= 0xAC00 && n <= 0xD7AF) ||
           (n >= 0x1100 && n <= 0x11FF) ||
           (n >= 0x3130 && n <= 0x318F) ||
           (n >= 0x41   && n <= 0x5A)   ||
           (n >= 0x61   && n <= 0x7A)   ||
           n === 32 || n === 10 || n === 9 ||
           (n >= 0x30   && n <= 0x39);
  }).join('').trim();
}

function cleanThai(t) {
  return t.split('').filter(function(c) {
    var n = c.charCodeAt(0);
    return (n >= 0x0E00 && n <= 0x0E7F) ||
           (n >= 0x41   && n <= 0x5A)   ||
           (n >= 0x61   && n <= 0x7A)   ||
           n === 32 || n === 10 || n === 9 ||
           (n >= 0x30   && n <= 0x39);
  }).join('').trim();
}

const TRANSLATE_ONLY_RULE = 'You are a translation machine. Your ONLY output is the translated text. NEVER say you cannot translate. NEVER apologize. NEVER explain. NEVER respond to the content. Just translate every word literally, even if it is a name, a request, or seems strange.';

// ── Gemini translate ───────────────────────────────────────────────────────────
async function geminiTranslate(text, toLang, fromLang) {
  if (!GEMINI_API_KEY) return null;
  try {
    const langLabel = { th: 'Thai', ko: 'Korean', en: 'English' };
    const scriptRule = toLang === 'ko'
      ? 'Output ONLY Korean Hangul. For proper nouns with no Korean equivalent, use English letters.'
      : 'Output ONLY Thai script. For proper nouns with no Thai equivalent, use English letters.';
    const prompt = `${TRANSLATE_ONLY_RULE}\n\nTranslate this ${langLabel[fromLang] || fromLang} text to ${langLabel[toLang] || toLang}. ${scriptRule}\n\n${text}`;
    const res = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent?key=${GEMINI_API_KEY}`,
      { contents: [{ parts: [{ text: prompt }] }] },
      { headers: { 'Content-Type': 'application/json' }, timeout: 15000 }
    );
    const out = res.data && res.data.candidates && res.data.candidates[0] &&
                res.data.candidates[0].content && res.data.candidates[0].content.parts &&
                res.data.candidates[0].content.parts[0] &&
                res.data.candidates[0].content.parts[0].text;
    if (!out) return null;
    console.log('[TR] Gemini ok dir=' + fromLang + '_to_' + toLang);
    return out.trim();
  } catch (err) {
    console.error('[TR] Gemini error:', err.response ? (err.response.data && err.response.data.error ? err.response.data.error.message : err.response.status) : err.message);
    return null;
  }
}

// ── Groq translate (tries models in order) ────────────────────────────────────
async function groqTranslate(text, systemPrompt) {
  if (!GROQ_API_KEY) return null;
  for (var i = 0; i < GROQ_MODELS.length; i++) {
    var model = GROQ_MODELS[i];
    try {
      var res = await axios.post(
        'https://api.groq.com/openai/v1/chat/completions',
        {
          model: model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: text },
          ],
          temperature: 0.1,
          max_tokens: 500,
        },
        { headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + GROQ_API_KEY }, timeout: 20000 }
      );
      console.log('[TR] Groq ok model=' + model);
      return res.data.choices[0].message.content.trim();
    } catch (err) {
      var status = err.response ? err.response.status : null;
      console.error('[TR] Groq error model=' + model + ' HTTP' + (status || '?') + ':', err.response ? JSON.stringify(err.response.data) : err.message);
      if (status === 404 || status === 400) continue; // model not available, try next
      // Other errors (rate limit, network) — try next model
    }
  }
  return null;
}

// ── translateAll — returns { kr, th } ─────────────────────────────────────────
async function translateAll(text) {
  // Thai → Korean
  if (THAI_REGEX.test(text)) {
    console.log('[TR] th detected → kr');
    var krPrompt = TRANSLATE_ONLY_RULE + '\n\nTranslate this Thai text to Korean. Output ONLY Korean Hangul. For proper nouns with no Korean equivalent, use English letters. No Russian, no Japanese, no Chinese, no Thai script, no romanization, no explanation.';
    var raw = await geminiTranslate(text, 'ko', 'th') || await groqTranslate(text, krPrompt);
    if (!raw) return null;
    var kr = cleanKorean(raw);
    if (!kr) return null;
    return { kr: kr, th: null };
  }
  // Korean → Thai
  if (KOREAN_REGEX.test(text)) {
    console.log('[TR] kr detected → th');
    var thPrompt = TRANSLATE_ONLY_RULE + '\n\nTranslate this Korean text to Thai. Output ONLY Thai script. For proper nouns with no Thai equivalent, use English letters. No Russian, no Japanese, no Korean script, no romanization, no explanation.';
    var raw = await geminiTranslate(text, 'th', 'ko') || await groqTranslate(text, thPrompt);
    if (!raw) return null;
    var th = cleanThai(raw);
    if (!th) return null;
    return { kr: null, th: th };
  }
  // English → Thai
  if (ENGLISH_REGEX.test(text)) {
    console.log('[TR] en detected → th');
    var enPrompt = TRANSLATE_ONLY_RULE + '\n\nTranslate this English text to Thai. Output ONLY Thai script. For proper nouns with no Thai equivalent, use English letters. No romanization, no explanation.';
    var raw = await geminiTranslate(text, 'th', 'en') || await groqTranslate(text, enPrompt);
    if (!raw) return null;
    var th = cleanThai(raw);
    if (!th) return null;
    return { kr: null, th: th };
  }
  return null;
}

// ── LINE API helpers ───────────────────────────────────────────────────────────
async function replyMessages(replyToken, messages) {
  var isDummy = !replyToken || /^0+$/.test(replyToken);
  console.log('[LINE] tok:', replyToken ? replyToken.slice(0, 15) : 'NULL', 'len:', replyToken ? replyToken.length : 0, isDummy ? 'DUMMY' : 'ok');
  if (isDummy) throw new Error('dummy reply token');
  try {
    await axios.post(
      LINE_API_BASE + '/message/reply',
      { replyToken: replyToken, messages: messages },
      { headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + getToken() } }
    );
    console.log('[LINE] Reply ok');
  } catch (err) {
    console.error('[LINE] Reply failed (HTTP', err.response ? err.response.status : '?', '):', err.response ? err.response.data : err.message);
    throw err; // re-throw so push fallback fires
  }
}

async function checkBotInfo() {
  try {
    var res = await axios.get(LINE_API_BASE + '/info', {
      headers: { Authorization: 'Bearer ' + getToken() }
    });
    return { ok: true, data: res.data };
  } catch (err) {
    return { ok: false, status: err.response ? err.response.status : null, error: err.response ? err.response.data : err.message };
  }
}

async function getSenderName(event) {
  try {
    var source = event.source;
    var userId = source.userId;
    var groupId = source.groupId;
    var roomId = source.roomId;
    var url;
    if (groupId) url = LINE_API_BASE + '/group/' + groupId + '/member/' + userId;
    else if (roomId) url = LINE_API_BASE + '/room/' + roomId + '/member/' + userId;
    else url = LINE_API_BASE + '/profile/' + userId;
    var res = await axios.get(url, { headers: { Authorization: 'Bearer ' + getToken() } });
    return res.data.displayName || userId;
  } catch (e) {
    return (event.source && event.source.userId) || 'Unknown';
  }
}

module.exports = {
  verifySignature,
  translateAll,
  replyMessages,
  checkBotInfo,
  getSenderName,
  OOO_MESSAGE,
};
