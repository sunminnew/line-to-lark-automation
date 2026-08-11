/**
 * lineHandler.js
 * Bidirectional translation: Thai<->Korean via Groq API (free tier).
 * All improvements consolidated: fallback models, repetition detection,
 * URL stripping, enterprise prompts, tone mirroring, script validation.
 */
const axios = require('axios');
const crypto = require('crypto');

const LINE_API_BASE  = 'https://api.line.me/v2/bot';
const ACCESS_TOKEN   = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET;
const GROQ_API_KEY   = process.env.GROQ_API_KEY;

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

var GROQ_MODELS = ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'gemma2-9b-it'];

function isRepetitive(text) {
  if (text.length < 100) return false;
  var tokens = text.trim().split(/\s+/);
  if (tokens.length < 15) return false;
  var seen = {};
  for (var i = 0; i < tokens.length - 2; i++) {
    var key = tokens[i] + ' ' + tokens[i + 1] + ' ' + tokens[i + 2];
    seen[key] = (seen[key] || 0) + 1;
    if (seen[key] >= 5) return true;
  }
  return false;
}

async function groqTranslate(text, systemPrompt) {
  for (var i = 0; i < GROQ_MODELS.length; i++) {
    var model = GROQ_MODELS[i];
    try {
      var res = await axios.post(
        'https://api.groq.com/openai/v1/chat/completions',
        {
          model: model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user',   content: text },
          ],
          temperature: 0.1,
          max_tokens: 1500,
        },
        { headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + GROQ_API_KEY } }
      );
      var result = res.data.choices[0].message.content.trim();
      if (isRepetitive(result)) {
        console.warn('[Translate] repetition loop on ' + model + ', trying next...');
        continue;
      }
      if (i > 0) console.log('[Translate] used fallback model:', model);
      return result;
    } catch (err) {
      var isRateLimit = err.response && err.response.data && err.response.data.error && err.response.data.error.code === 'rate_limit_exceeded';
      if (isRateLimit && i < GROQ_MODELS.length - 1) {
        console.warn('[Translate] rate limit on ' + model + ', trying next...');
        continue;
      }
      console.error('[Translate] Groq error:', err.response ? err.response.data : err.message);
      return null;
    }
  }
  return null;
}

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

var SYSTEM_PROMPT_TO_THAI =
  'You are an enterprise-grade AI translation engine. [Chat Context] is [Group].\n\n' +
  'MODE: GROUP_CHAT_TRANSLATOR\n' +
  '- PURE TRANSLATION ONLY. You are a proxy translator between third parties.\n' +
  '- You are NEVER the recipient. Translate questions/requests as-is. NEVER answer them.\n' +
  '- NO FILLERS: No intro or closing remarks. Output ONLY the translated text.\n\n' +
  'RULES:\n' +
  '1. TONE MIRRORING: Mirror exact politeness. Korean \ubc18\ub9d0/slang = casual Thai (no \u0e04\u0e23\u0e31\u0e1a/\u0e04\u0e48\u0e30). Korean \uc874\ub313\ub9d0 = polite Thai. Never elevate tone.\n' +
  '2. COMPLETENESS: Translate EVERY word. Never omit, skip, or summarize.\n' +
  '3. PROPER NOUNS: Korean names -> English transliteration (e.g. \ucd5c\uc120\ubbfc -> Choi Sun-min). Brand names stay in English.\n' +
  '4. INTENT: Capture cultural nuances and idioms accurately.\n' +
  '5. CURRENCY: Keep amounts and currency units exactly as written. No conversion.\n' +
  '6. OUTPUT: Thai script only. Unknown proper nouns in English. No romanization.\n\n' +
  'GLOSSARY: \ubcc0\ud638\uc0ac=\u0e17\u0e19\u0e32\u0e22\u0e04\u0e27\u0e32\u0e21(NOT \u0e1c\u0e39\u0e49\u0e1e\u0e34\u0e1e\u0e32\u0e01\u0e29\u0e32), \ud310\uc0ac=\u0e1c\u0e39\u0e49\u0e1e\u0e34\u0e1e\u0e32\u0e01\u0e29\u0e32, \ubc95\uc6d0=\u0e28\u0e32\u0e25, \ube44\uc790=\u0e27\u0e35\u0e0b\u0e48\u0e32, \ud68c\uc0ac=\u0e1a\u0e23\u0e34\u0e29\u0e31\u0e17, \uace0\uac1d=\u0e25\u0e39\u0e01\u0e04\u0e49\u0e32, \uc218\uc218\ub8cc=\u0e04\u0e48\u0e32\u0e18\u0e23\u0e23\u0e21\u0e40\u0e19\u0e35\u0e22\u0e21, \ucde8\uc18c=\u0e22\u0e01\u0e40\u0e25\u0e34\u0e01';

var SYSTEM_PROMPT_TO_KOREAN =
  'You are an enterprise-grade AI translation engine. [Chat Context] is [Group].\n\n' +
  'MODE: GROUP_CHAT_TRANSLATOR\n' +
  '- PURE TRANSLATION ONLY. You are a proxy translator between third parties.\n' +
  '- You are NEVER the recipient. Translate questions/requests as-is. NEVER answer them.\n' +
  '- NO FILLERS: No intro or closing remarks. Output ONLY the translated text.\n\n' +
  'RULES:\n' +
  '1. TONE MIRRORING: Mirror exact politeness. Casual Thai (no \u0e04\u0e23\u0e31\u0e1a/\u0e04\u0e48\u0e32) = Korean \ubc18\ub9d0. Polite Thai (\u0e04\u0e23\u0e31\u0e1a/\u0e04\u0e48\u0e32/\u0e04\u0e30/\u0e19\u0e30\u0e04\u0e30) = Korean \uc874\ub313\ub9d0. Never elevate tone.\n' +
  '2. COMPLETENESS: Translate EVERY word. Never omit, skip, or summarize.\n' +
  '3. PROPER NOUNS: Brand names and English names stay in English letters.\n' +
  '4. INTENT: Capture cultural nuances and idioms accurately.\n' +
  '5. CURRENCY: Keep amounts and currency units exactly as written. No conversion.\n' +
  '6. OUTPUT: Korean Hangul only. Unknown proper nouns in English. NEVER romanize Korean words.\n\n' +
  'GLOSSARY: \u0e17\u0e19\u0e32\u0e22/\u0e17\u0e19\u0e32\u0e22\u0e04\u0e27\u0e32\u0e21=\ubcc0\ud638\uc0ac(NOT \ud310\uc0ac), \u0e1c\u0e39\u0e49\u0e1e\u0e34\u0e1e\u0e32\u0e01\u0e29\u0e32=\ud310\uc0ac, \u0e28\u0e32\u0e25=\ubc95\uc6d0, \u0e27\u0e35\u0e0b\u0e48\u0e32=\ube44\uc790, \u0e1a\u0e23\u0e34\u0e29\u0e31\u0e17=\ud68c\uc0ac, \u0e25\u0e39\u0e01\u0e04\u0e49\u0e32=\uace0\uac1d, \u0e04\u0e48\u0e32\u0e18\u0e23\u0e23\u0e21\u0e40\u0e19\u0e35\u0e22\u0e21=\uc218\uc218\ub8cc, \u0e22\u0e01\u0e40\u0e25\u0e34\u0e01=\ucde8\uc18c';

async function translateAll(text) {
  var cleanText = text.replace(/https?:\/\/[^\s]+/g, '').trim();
  if (!cleanText) return null;
  text = cleanText;

  if (THAI_REGEX.test(text)) {
    console.log('[TR] th->kr');
    var raw = await groqTranslate(text, SYSTEM_PROMPT_TO_KOREAN + '\n\nTranslate the following Thai text to Korean:');
    if (!raw) return null;
    var kr = cleanKorean(raw);
    if (!kr || !KOREAN_REGEX.test(kr)) return null;
    console.log('[TR] th->kr ok');
    return { kr: kr, th: null };
  }

  if (KOREAN_REGEX.test(text)) {
    console.log('[TR] kr->th');
    var raw = await groqTranslate(text, SYSTEM_PROMPT_TO_THAI + '\n\nTranslate the following Korean text to Thai:');
    if (!raw) return null;
    var th = cleanThai(raw);
    if (!th || !THAI_REGEX.test(th)) return null;
    console.log('[TR] kr->th ok');
    return { kr: null, th: th };
  }

  if (ENGLISH_REGEX.test(text) && !THAI_REGEX.test(text) && !KOREAN_REGEX.test(text)) {
    console.log('[TR] en->th');
    var raw = await groqTranslate(text, SYSTEM_PROMPT_TO_THAI + '\n\nTranslate the following English text to Thai:');
    if (!raw) return null;
    var th = cleanThai(raw);
    if (!th || !THAI_REGEX.test(th)) return null;
    console.log('[TR] en->th ok');
    return { kr: null, th: th };
  }

  return null;
}

async function translate(text) {
  var result = await translateAll(text);
  if (!result) return null;
  return result.kr || result.th || null;
}

async function replyMessages(replyToken, messages) {
  const isDummy = !replyToken || /^0+$/.test(replyToken);
  console.log('[LINE] tok:', replyToken ? replyToken.slice(0, 15) : 'NULL', 'isDummy:', isDummy);
  if (isDummy) throw new Error('dummy reply token');
  try {
    await axios.post(
      LINE_API_BASE + '/message/reply',
      { replyToken: replyToken, messages: messages },
      { headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + ACCESS_TOKEN } }
    );
    console.log('[LINE] Reply ok');
  } catch (err) {
    console.error('[LINE] Reply failed (HTTP', err.response ? err.response.status : '?', '):', err.response ? err.response.data : err.message);
    throw err;
  }
}

async function checkBotInfo() {
  try {
    const res = await axios.get(LINE_API_BASE + '/info', {
      headers: { Authorization: 'Bearer ' + ACCESS_TOKEN }
    });
    return { ok: true, data: res.data };
  } catch (err) {
    return { ok: false, status: err.response ? err.response.status : null, error: err.response ? err.response.data : err.message };
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
    if (groupId)     url = LINE_API_BASE + '/group/' + groupId + '/member/' + userId;
    else if (roomId) url = LINE_API_BASE + '/room/'  + roomId  + '/member/' + userId;
    else             url = LINE_API_BASE + '/profile/' + userId;
    const res = await axios.get(url, { headers: { Authorization: 'Bearer ' + ACCESS_TOKEN } });
    return res.data.displayName || userId;
  } catch (e) {
    return event.source.userId || 'Unknown';
  }
}

module.exports = {
  verifySignature: verifySignature,
  translate: translate,
  translateToKorean: translate,
  translateAll: translateAll,
  replyMessages: replyMessages,
  replyOOO: replyOOO,
  getSenderName: getSenderName,
  checkBotInfo: checkBotInfo,
  OOO_MESSAGE: OOO_MESSAGE,
};
