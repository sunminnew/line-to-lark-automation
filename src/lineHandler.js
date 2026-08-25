/**
 * lineHandler.js
 * Thai<->Korean bidirectional translation for LINE groups (Wisdom Consulting).
 * Chain: Cache -> Gemini (smart cooldown) -> Groq-20b -> Groq-120b
 * All services are FREE. No MyMemory or non-LLM translators.
 */
const axios = require('axios');
const crypto = require('crypto');

const LINE_API_BASE = 'https://api.line.me/v2/bot';
const ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET;
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || null;

const OOO_MESSAGE =
  '\u0e2a\u0e27\u0e31\u0e2a\u0e14\u0e35\u0e04\u0e48\u0e32/\u0e04\u0e23\u0e31\u0e1a \u0e02\u0e13\u0e30\u0e19\u0e35\u0e49\u0e2d\u0e22\u0e39\u0e48\u0e19\u0e2d\u0e01\u0e40\u0e27\u0e25\u0e32\u0e17\u0e33\u0e01\u0e32\u0e23 (09.00-18.00 \u0e19.) ' +
  '\u0e17\u0e32\u0e07\u0e17\u0e35\u0e21\u0e07\u0e32\u0e19\u0e44\u0e14\u0e49\u0e23\u0e31\u0e1a\u0e02\u0e49\u0e2d\u0e04\u0e27\u0e32\u0e21\u0e02\u0e2d\u0e07\u0e17\u0e48\u0e32\u0e19\u0e41\u0e25\u0e49\u0e27 \u0e41\u0e25\u0e30\u0e08\u0e30\u0e23\u0e35\u0e1a\u0e15\u0e34\u0e14\u0e15\u0e48\u0e2d\u0e01\u0e25\u0e31\u0e1a\u0e17\u0e31\u0e19\u0e17\u0e35\u0e43\u0e19\u0e40\u0e27\u0e25\u0e32\u0e17\u0e33\u0e01\u0e32\u0e23 ' +
  '\u0e02\u0e2d\u0e1a\u0e1e\u0e23\u0e30\u0e04\u0e38\u0e13\u0e17\u0e35\u0e48\u0e44\u0e27\u0e49\u0e27\u0e32\u0e07\u0e43\u0e08\u0e04\u0e48\u0e32/\u0e04\u0e23\u0e31\u0e1a';

const THAI_REGEX = /[\u0e00-\u0e7f]/;
const KOREAN_REGEX = /[\uac00-\ud7af\u1100-\u11ff\u3130-\u318f]/;
const ENGLISH_REGEX = /[a-zA-Z]/;

function verifySignature(rawBody, signature) {
  const hmac = crypto.createHmac('SHA256', CHANNEL_SECRET);
  hmac.update(rawBody);
  return hmac.digest('base64') === signature;
}

// ── Repetition detector ──────────────────────────────────────────────────────
function isRepetitive(text) {
  if (!text || text.length < 20) return false;
  if (text.length > 5000) return true; // unusually long = hallucination
  if (text.length < 60) return false;
  var tokens = text.trim().split(/\s+/);
  if (tokens.length < 6) return false;
  // Frequency check: any single token > 25% of total = repetitive loop
  var freq = {};
  for (var j = 0; j < tokens.length; j++) {
    freq[tokens[j]] = (freq[tokens[j]] || 0) + 1;
    if (freq[tokens[j]] / tokens.length > 0.25) return true;
  }
  // Trigram check
  var seen = {};
  for (var i = 0; i < tokens.length - 2; i++) {
    var tri = tokens[i] + ' ' + tokens[i + 1] + ' ' + tokens[i + 2];
    if (seen[tri]) return true;
    seen[tri] = true;
  }
  return false;
}

// ── Output cleaners ──────────────────────────────────────────────────────────
function cleanKorean(t) {
  return t.split('').filter(function(c) {
    var n = c.charCodeAt(0);
    return (n >= 0xAC00 && n <= 0xD7AF) || (n >= 0x1100 && n <= 0x11FF) ||
      (n >= 0x3130 && n <= 0x318F) || (n >= 0x41 && n <= 0x5A) ||
      (n >= 0x61 && n <= 0x7A) || n === 32 || n === 10 || n === 9 ||
      (n >= 0x30 && n <= 0x39);
  }).join('').trim();
}

function cleanThai(t) {
  return t.split('').filter(function(c) {
    var n = c.charCodeAt(0);
    return (n >= 0x0E00 && n <= 0x0E7F) || (n >= 0x41 && n <= 0x5A) ||
      (n >= 0x61 && n <= 0x7A) || n === 32 || n === 10 || n === 9 ||
      (n >= 0x30 && n <= 0x39);
  }).join('').trim();
}

// ── System prompts ───────────────────────────────────────────────────────────
var SYSTEM_PROMPT_TO_THAI =
  'You are a translation engine for a Thai-Korean business consulting group chat.\n' +
  'OUTPUT ONLY the translated Thai text. No explanations, no intro, no answers.\n' +
  'Rules: (1) Formal polite Thai, end sentences with \u0e04\u0e23\u0e31\u0e1a. ' +
  '(2) Korean names use English romanization. (3) Keep @mentions unchanged. ' +
  '(4) Currency exactly: \u0e1a\u0e32\u0e17=\u0e1a\u0e32\u0e17, \uc6d0=\u0e27\u0e2d\u0e19, no conversion.\n' +
  'Key: \ubcc0\ud638\uc0ac=\u0e17\u0e19\u0e32\u0e22\u0e04\u0e27\u0e32\u0e21, \ud310\uc0ac=\u0e1c\u0e39\u0e49\u0e1e\u0e34\u0e1e\u0e32\u0e01\u0e29\u0e32, \ubc95\uc6d0=\u0e28\u0e32\u0e25, \ube44\uc790=\u0e27\u0e35\u0e0b\u0e48\u0e32, \ud68c\uc0ac=\u0e1a\u0e23\u0e34\u0e29\u0e31\u0e17, ' +
  '\uace0\uac1d=\u0e25\u0e39\u0e01\u0e04\u0e49\u0e32, \uc218\uc218\ub8cc=\u0e04\u0e48\u0e32\u0e18\u0e23\u0e23\u0e21\u0e40\u0e19\u0e35\u0e22\u0e21, \ucde8\uc18c=\u0e22\u0e01\u0e40\u0e25\u0e34\u0e01, \uacc4\uc57d=\u0e2a\u0e31\u0e0d\u0e0d\u0e32, ' +
  '\uc5ec\uad8c=\u0e2b\u0e19\u0e31\u0e07\u0e2a\u0e37\u0e2d\u0e40\u0e14\u0e34\u0e19\u0e17\u0e32\u0e07, \ud655\uc778=\u0e22\u0e37\u0e19\u0e22\u0e31\u0e19, \uc9c4\ud589=\u0e14\u0e33\u0e40\u0e19\u0e34\u0e19\u0e01\u0e32\u0e23, ' +
  '\ub2f4\ub2f9\uc790=\u0e1c\u0e39\u0e49\u0e23\u0e31\u0e1a\u0e1c\u0e34\u0e14\u0e0a\u0e2d\u0e1a, \uc11c\ub958=\u0e40\u0e2d\u0e01\u0e2a\u0e32\u0e23, \uc785\uae08=\u0e42\u0e2d\u0e19\u0e40\u0e07\u0e34\u0e19';

var SYSTEM_PROMPT_TO_KOREAN =
  'You are a translation engine for a Thai-Korean business consulting group chat.\n' +
  'OUTPUT ONLY the translated Korean text. No explanations, no intro, no answers.\n' +
  'Rules: (1) Formal \ud569\ucabd\uccb4 (-\uc2b5\ub2c8\ub2e4/-\uc785\ub2c8\ub2e4). Use \uc800\ud76c, never \uc6b0\ub9ac. No \ubc18\ub9d0. ' +
  '(2) Keep @mentions unchanged. (3) Brand names stay in English. ' +
  '(4) Currency exactly: \u0e1a\u0e32\u0e17=\ubc14\ud2b8, \uc6d0=\uc6d0, no conversion.\n' +
 
  '(5) IMPORTANT: Thai ไม่ทราบว่า...ได้ไหม(คะ/ครับ) is a POLITE REQUEST = translate as ~해 주실 수 있으실까요? NEVER 모르겠습니다. ทางบริษัท=귀사/회사 측, NOT 저희 회사.\n' +
  '(6) Thai ค่ะ/คะ/ครับ are polite particles, NOT standalone words. Never translate alone as 입니다. If entire message is only ค่ะ/คะ/ครับ, translate as 네.\n' +
  'Key: \u0e17\u0e19\u0e32\u0e22\u0e04\u0e27\u0e32\u0e21=\ubcc0\ud638\uc0ac, \u0e1c\u0e39\u0e49\u0e1e\u0e34\u0e1e\u0e32\u0e01\u0e29\u0e32=\ud310\uc0ac, \u0e28\u0e32\u0e25=\ubc95\uc6d0, \u0e27\u0e35\u0e0b\u0e48\u0e32=\ube44\uc790, \u0e1a\u0e23\u0e34\u0e29\u0e31\u0e17=\ud68c\uc0ac, ' +
  '\u0e25\u0e39\u0e01\u0e04\u0e49\u0e32=\uace0\uac1d, \u0e04\u0e48\u0e32\u0e18\u0e23\u0e23\u0e21\u0e40\u0e19\u0e35\u0e22\u0e21=\uc218\uc218\ub8cc, \u0e22\u0e01\u0e40\u0e25\u0e34\u0e01=\ucde8\uc18c, \u0e2a\u0e31\u0e0d\u0e0d\u0e32=\uacc4\uc57d, ' +
  '\u0e2b\u0e19\u0e31\u0e07\u0e2a\u0e37\u0e2d\u0e40\u0e14\u0e34\u0e19\u0e17\u0e32\u0e07=\uc5ec\uad8c, \u0e22\u0e37\u0e19\u0e22\u0e31\u0e19=\ud655\uc778, \u0e14\u0e33\u0e40\u0e19\u0e34\u0e19\u0e01\u0e32\u0e23=\uc9c4\ud589, ' +
  '\u0e1c\u0e39\u0e49\u0e23\u0e31\u0e1a\u0e1c\u0e14\u0e0a\u0e2d\u0e1a=\ub2f4\ub2f9\uc790, \u0e40\u0e2d\u0e01\u0e2a\u0e32\u0e23=\uc11c\ub958, \u0e42\u0e2d\u0e19\u0e40\u0e07\u0e34\u0e19=\uc785\uae08';

// ── Translation cache (10-min TTL, max 200 entries) ──────────────────────────
var _cache = {};
var CACHE_TTL = 10 * 60 * 1000;

function getCached(key) {
  var e = _cache[key];
  if (!e) return null;
  if (Date.now() - e.t > CACHE_TTL) { delete _cache[key]; return null; }
  return e.v;
}

function setCached(key, value) {
  var keys = Object.keys(_cache);
  if (keys.length > 200) delete _cache[keys[0]];
  _cache[key] = { v: value, t: Date.now() };
}

// ── Azure Translator (PRIMARY if key set — 2M chars/month free) ──────────────
const AZURE_KEY = process.env.AZURE_TRANSLATOR_KEY;
const AZURE_REGION = process.env.AZURE_TRANSLATOR_REGION || 'eastasia';
console.log('[Azure] KEY set:', !!AZURE_KEY, '| REGION:', AZURE_REGION);

async function azureTranslate(text, fromLang, toLang) {
  if (!AZURE_KEY) return null;
  try {
    var r = await axios.post(
      'https://api.cognitive.microsofttranslator.com/translate?api-version=3.0&from=' + fromLang + '&to=' + toLang,
      [{ text: text }],
      { headers: { 'Ocp-Apim-Subscription-Key': AZURE_KEY, 'Ocp-Apim-Subscription-Region': AZURE_REGION, 'Content-Type': 'application/json' }, timeout: 8000 }
    );
    var result = r.data[0].translations[0].text.trim();
    if (!result) return null;
    console.log('[Translate] Azure ok (' + fromLang + '->' + toLang + ')');
    return result;
  } catch (err) {
    console.warn('[Translate] Azure error:', err.response ? err.response.data : err.message);
    return null;
  }
}

// ── Gemini (smart cooldown — reads retry-after from 429 response) ────────────
var geminiCooldownUntil = 0;

async function geminiTranslate(text, systemPrompt) {
  if (!GEMINI_API_KEY) return null;
  if (Date.now() < geminiCooldownUntil) {
    console.log('[Translate] Gemini cooldown ' + Math.ceil((geminiCooldownUntil - Date.now()) / 1000) + 's, skip');
    return null;
  }
  var ctrl = new AbortController();
  var timer = setTimeout(function() { ctrl.abort(); }, 20000);
  try {
    var res = await axios.post(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=' + GEMINI_API_KEY,
      {
        system_instruction: { parts: [{ text: systemPrompt }] },
        contents: [{ parts: [{ text: text }] }],
        generationConfig: { temperature: 0.1, maxOutputTokens: 3000 },
      },
      { headers: { 'Content-Type': 'application/json' }, signal: ctrl.signal }
    );
    clearTimeout(timer);
    var result = res.data.candidates[0].content.parts[0].text.trim();
    if (isRepetitive(result)) return null;
    // Verify expected script
    if (systemPrompt.includes('Korean') && !/[\uac00-\ud7af]/.test(result)) return null;
    if (systemPrompt.includes('Thai') && !/[\u0e00-\u0e7f]/.test(result)) return null;
    console.log('[Translate] Gemini ok');
    return result;
  } catch (err) {
    clearTimeout(timer);
    if (err.response && err.response.status === 429) {
      var msg = (err.response.data && err.response.data.error && err.response.data.error.message) || '';
      var m = msg.match(/retry in ([\d.]+)s/i);
      var waitSec = m ? parseFloat(m[1]) + 3 : 62;
      geminiCooldownUntil = Date.now() + waitSec * 1000;
      console.warn('[Translate] Gemini 429 — cooldown ' + Math.ceil(waitSec) + 's');
    } else {
      console.error('[Translate] Gemini error:', err.response ? err.response.data : err.message);
    }
    return null;
  }
}

// ── Groq LLMs (200K tokens/day free) ────────────────────────────────────────
var GROQ_MODELS = ['openai/gpt-oss-120b', 'openai/gpt-oss-20b'];

// ── aiTranslate: Cache -> Gemini -> Groq-20b -> Groq-120b ───────────────────
async function aiTranslate(text, systemPrompt, fromLang, toLang) {
  var cacheKey = (fromLang || '') + '|' + (toLang || '') + '|' + text;
  var cached = getCached(cacheKey);
  if (cached) {
    console.log('[Translate] Cache hit (' + fromLang + '->' + toLang + ')');
    return cached;
  }

  var result;

  // 1. Gemini (smart cooldown)
  if (GEMINI_API_KEY) {
    result = await geminiTranslate(text, systemPrompt);
    if (result) { setCached(cacheKey, result); return result; }
    console.warn('[Translate] Gemini unavailable, trying Groq...');
  }

  // 2. Groq LLM models
  for (var i = 0; i < GROQ_MODELS.length; i++) {
    var model = GROQ_MODELS[i];
    var aCtrl = new AbortController();
    var aTimer = setTimeout(function() { aCtrl.abort(); }, 25000);
    try {
      var res = await axios.post(
        'https://api.groq.com/openai/v1/chat/completions',
        { model: model, messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: text }], temperature: 0.1, max_tokens: 3000 },
        { headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + GROQ_API_KEY }, signal: aCtrl.signal }
      );
      var groqResult = res.data.choices[0].message.content.trim();
      clearTimeout(aTimer);
      if (isRepetitive(groqResult)) { console.warn('[Translate] repetition on ' + model + ', trying next...'); continue; }
      // Verify output contains expected script — reject if wrong language
      if (toLang === 'ko' && !/[\uac00-\ud7af]/.test(groqResult)) { console.warn('[Translate] no Korean chars from ' + model + ', trying next...'); continue; }
      if (toLang === 'th' && !/[\u0e00-\u0e7f]/.test(groqResult)) { console.warn('[Translate] no Thai chars from ' + model + ', trying next...'); continue; }
      console.log('[Translate] Groq ok: ' + model);
      setCached(cacheKey, groqResult);
      return groqResult;
    } catch (err) {
      clearTimeout(aTimer);
      if (i < GROQ_MODELS.length - 1) { console.warn('[Translate] ' + model + ' failed, trying next...'); continue; }
      console.error('[Translate] Groq exhausted:', err.response ? err.response.data : err.message);
    }
  }
  return null;
}

// ── translateAll ─────────────────────────────────────────────────────────────
async function translateAll(text) {
  var cleanText = text.replace(/https?:\/\/[^\s]+/g, '').trim();
  if (!cleanText) return null;
  text = cleanText;
  if (THAI_REGEX.test(text) && KOREAN_REGEX.test(text)) return null;

  if (THAI_REGEX.test(text)) {
    if (/^(ค่ะ|คะ|ครับ|นะคะ|นะค่ะ|นะครับ|จ้า|จ้ะ|ค่ะๆ|คะๆ|ครับๆ)$/.test(text.trim())) { console.log('[TR] particle-only, returning 네'); return { kr: '네', th: null }; }
    console.log('[TR] th->kr');
    var kr = await azureTranslate(text, 'th', 'ko');
    if (!kr) {
      var raw = await aiTranslate(text, SYSTEM_PROMPT_TO_KOREAN + '\n\nTranslate the following Thai text to Korean:', 'th', 'ko');
      kr = raw ? cleanKorean(raw) : null;
    } else { kr = cleanKorean(kr); }
    if (!kr || !KOREAN_REGEX.test(kr)) return null;
    console.log('[TR] th->kr ok');
    return { kr: kr, th: null };
  }

  if (KOREAN_REGEX.test(text)) {
    console.log('[TR] kr->th');
    var th = await azureTranslate(text, 'ko', 'th');
    if (!th) {
      var raw = await aiTranslate(text, SYSTEM_PROMPT_TO_THAI + '\n\nTranslate the following Korean text to Thai:', 'ko', 'th');
      th = raw ? cleanThai(raw) : null;
    } else { th = cleanThai(th); }
    if (!th || !THAI_REGEX.test(th)) return null;
    console.log('[TR] kr->th ok');
    return { kr: null, th: th };
  }

  if (ENGLISH_REGEX.test(text) && !THAI_REGEX.test(text) && !KOREAN_REGEX.test(text)) {
    console.log('[TR] en->th');
    var th = await azureTranslate(text, 'en', 'th');
    if (!th) {
      var raw = await aiTranslate(text, SYSTEM_PROMPT_TO_THAI + '\n\nTranslate the following English text to Thai:', 'en', 'th');
      th = raw ? cleanThai(raw) : null;
    } else { th = cleanThai(th); }
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
    const res = await axios.get(LINE_API_BASE + '/info', { headers: { Authorization: 'Bearer ' + ACCESS_TOKEN } });
    return { ok: true, data: res.data, gemini: !!GEMINI_API_KEY };
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
    if (groupId) url = LINE_API_BASE + '/group/' + groupId + '/member/' + userId;
    else if (roomId) url = LINE_API_BASE + '/room/' + roomId + '/member/' + userId;
    else url = LINE_API_BASE + '/profile/' + userId;
    const res = await axios.get(url, { headers: { Authorization: 'Bearer ' + ACCESS_TOKEN } });
    return res.data.displayName || userId;
  } catch (e) {
    return event.source.userId || 'Unknown';
  }
}

module.exports = {
  verifySignature,
  translate,
  translateToKorean: translate,
  translateAll,
  replyMessages,
  replyOOO,
  getSenderName,
  checkBotInfo,
  OOO_MESSAGE,
};
