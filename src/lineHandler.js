/**
 * lineHandler.js
 * Bidirectional translation: Thai<->Korean via Groq API (free tier) + Gemini fallback.
 * Fallback chain: openai/gpt-oss-20b -> openai/gpt-oss-120b -> Gemini 3.6 Flash
 */
const axios = require('axios');
const crypto = require('crypto');

const LINE_API_BASE  = 'https://api.line.me/v2/bot';
const ACCESS_TOKEN   = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET;
const GROQ_API_KEY   = process.env.GROQ_API_KEY;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || null; // optional — activates 4th fallback

const OOO_MESSAGE =
  '\u0e2a\u0e27\u0e31\u0e2a\u0e14\u0e35\u0e04\u0e48\u0e32/\u0e04\u0e23\u0e31\u0e1a \u0e02\u0e13\u0e30\u0e19\u0e35\u0e49\u0e2d\u0e22\u0e39\u0e48\u0e19\u0e2d\u0e01\u0e40\u0e27\u0e25\u0e32\u0e17\u0e33\u0e01\u0e32\u0e23 (09.00-18.00 \u0e19.) ' +
  '\u0e17\u0e32\u0e07\u0e17\u0e35\u0e21\u0e07\u0e32\u0e19\u0e44\u0e14\u0e49\u0e23\u0e31\u0e1a\u0e02\u0e49\u0e2d\u0e04\u0e27\u0e32\u0e21\u0e02\u0e2d\u0e07\u0e17\u0e48\u0e32\u0e19\u0e41\u0e25\u0e49\u0e27 \u0e41\u0e25\u0e30\u0e08\u0e30\u0e23\u0e35\u0e1a\u0e15\u0e34\u0e14\u0e15\u0e48\u0e2d\u0e01\u0e25\u0e31\u0e1a\u0e17\u0e31\u0e19\u0e17\u0e35\u0e43\u0e19\u0e40\u0e27\u0e25\u0e32\u0e17\u0e33\u0e01\u0e32\u0e23 ' +
  '\u0e02\u0e2d\u0e1a\u0e1e\u0e23\u0e30\u0e04\u0e38\u0e13\u0e17\u0e35\u0e48\u0e44\u0e27\u0e49\u0e27\u0e32\u0e07\u0e43\u0e08\u0e04\u0e48\u0e32/\u0e04\u0e23\u0e31\u0e1a';

const THAI_REGEX    = /[\u0e00-\u0e7f]/;
const KOREAN_REGEX  = /[\uac00-\ud7af\u1100-\u11ff\u3130-\u318f]/;
const ENGLISH_REGEX = /[a-zA-Z]/;

function verifySignature(rawBody, signature) {
  const hmac = crypto.createHmac('SHA256', CHANNEL_SECRET);
  hmac.update(rawBody);
  return hmac.digest('base64') === signature;
}

// ── Repetition loop detector ────────────────────────────────────────────────
function isRepetitive(text) {
  if (!text || text.length < 20) return false;
  // Output much longer than would be sensible
  if (text.length > 4000) return true;
  // Word-trigram repetition (catches true hallucination loops)
  if (text.length < 100) return false;
  var tokens = text.trim().split(/\s+/);
  if (tokens.length < 10) return false;
  var seen = {};
  for (var i = 0; i < tokens.length - 2; i++) {
    var trigram = tokens[i] + ' ' + tokens[i+1] + ' ' + tokens[i+2];
    if (seen[trigram]) return true;
    seen[trigram] = true;
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

// ── Enterprise system prompts ────────────────────────────────────────────────
var SYSTEM_PROMPT_TO_THAI =
  'You are a translation engine for a Thai-Korean business consulting group chat.\n' +
  'OUTPUT ONLY the translated Thai text. No explanations, no intro, no answers.\n' +
  'Rules: (1) Formal polite Thai, end sentences with ครับ. ' +
  '(2) Korean names → English romanization. (3) Keep @mentions unchanged. ' +
  '(4) Keep currency amounts exactly as written — บาท=บาท, 원=วอน, no conversion.\n' +
  'Key terms: 변호사=ทนายความ, 판사=ผู้พิพากษา, 법원=ศาล, 비자=วีซ่า, 회사=บริษัท, ' +
  '고객=ลูกค้า, 수수료=ค่าธรรมเนียม, 취소=ยกเลิก, 계약=สัญญา, 여권=หนังสือเดินทาง, ' +
  '확인=ยืนยัน, 진행=ดำเนินการ, 담당자=ผู้รับผิดชอบ, 서류=เอกสาร, 입금=โอนเงิน';

var SYSTEM_PROMPT_TO_KOREAN =
  'You are a translation engine for a Thai-Korean business consulting group chat.\n' +
  'OUTPUT ONLY the translated Korean text. No explanations, no intro, no answers.\n' +
  'Rules: (1) Formal 합쇼체 (-습니다/-입니다). Use 저희, never 우리. No 반말. ' +
  '(2) Keep @mentions unchanged. (3) Brand names stay in English. ' +
  '(4) Keep currency amounts exactly — บาท=바트, 원=원, no conversion.\n' +
  'Key terms: ทนายความ=변호사, ผู้พิพากษา=판사, ศาล=법원, วีซ่า=비자, บริษัท=회사, ' +
  'ลูกค้า=고객, ค่าธรรมเนียม=수수료, ยกเลิก=취소, สัญญา=계약, หนังสือเดินทาง=여권, ' +
  'ยืนยัน=확인, ดำเนินการ=진행, ผู้รับผิดชอบ=담당자, เอกสาร=서류, โอนเงิน=입금';



// ── Azure Cognitive Translator (PRIMARY — 2M chars/month free, no token limits) ──
const AZURE_KEY    = process.env.AZURE_TRANSLATOR_KEY;
const AZURE_REGION = process.env.AZURE_TRANSLATOR_REGION || 'eastasia';

async function azureTranslate(text, fromLang, toLang) {
  if (!AZURE_KEY) return null;
  try {
    var aRes = await axios.post(
      'https://api.cognitive.microsofttranslator.com/translate?api-version=3.0&from=' + fromLang + '&to=' + toLang,
      [{ text: text }],
      { headers: {
          'Ocp-Apim-Subscription-Key': AZURE_KEY,
          'Ocp-Apim-Subscription-Region': AZURE_REGION,
          'Content-Type': 'application/json'
      }, timeout: 8000 }
    );
    var result = aRes.data[0].translations[0].text.trim();
    if (!result) return null;
    console.log('[Translate] Azure ok (' + fromLang + '->' + toLang + ')');
    return result;
  } catch (err) {
    console.warn('[Translate] Azure error:', err.response ? err.response.data : err.message);
    return null;
  }
}

// ── Gemini fallback (4th layer, activates if GEMINI_API_KEY is set) ──────────
async function geminiTranslate(text, systemPrompt) {
  if (!GEMINI_API_KEY) return null;
    var gCtrl = new AbortController();
      var gTimer = setTimeout(function() { gCtrl.abort(); }, 30000);
  try {
    const res = await axios.post(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=' + GEMINI_API_KEY,
      {
        system_instruction: { parts: [{ text: systemPrompt }] },
        contents: [{ parts: [{ text: text }] }],
        generationConfig: { temperature: 0.1, maxOutputTokens: 1500 },
      },
      { headers: { 'Content-Type': 'application/json' }, signal: gCtrl.signal }
    );
    const result = res.data.candidates[0].content.parts[0].text.trim();
        clearTimeout(gTimer);
    if (isRepetitive(result)) return null;
    console.log('[Translate] used Gemini fallback');
    return result;
  } catch (err) {
    console.error('[Translate] Gemini error:', err.response ? err.response.data : err.message);
        clearTimeout(gTimer);
    return null;
  }
}

// ── Groq models (3 primary + Gemini as 4th) ─────────────────────────────────
var GROQ_MODELS = ['openai/gpt-oss-20b', 'openai/gpt-oss-120b'];

async function aiTranslate(text, systemPrompt) {
  // PRIMARY: Gemini (1M tokens/day free vs Groq 200K/day — far more generous)
  if (GEMINI_API_KEY) {
    var gemResult = await geminiTranslate(text, systemPrompt);
    if (gemResult) return gemResult;
    console.warn('[Translate] Gemini failed, falling back to Groq...');
  }
  // FALLBACK: Groq models
  for (var i = 0; i < GROQ_MODELS.length; i++) {
    var model = GROQ_MODELS[i];
    let aCtrl = new AbortController();
    let aTimer = setTimeout(function() { aCtrl.abort(); }, 12000);
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
        { headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + GROQ_API_KEY }, signal: aCtrl.signal }
      );
      var result = res.data.choices[0].message.content.trim();
      clearTimeout(aTimer);
      if (isRepetitive(result)) {
        console.warn('[Translate] repetition on ' + model + ', trying next...');
        continue;
      }
      console.log('[Translate] Groq fallback used model:', model);
      return result;
    } catch (err) {
      clearTimeout(aTimer);
      if (i < GROQ_MODELS.length - 1) {
        console.warn('[Translate] ' + model + ' failed, trying next Groq model...');
        continue;
      }
      console.error('[Translate] all models exhausted. Last error:', err.response ? err.response.data : err.message);
    }
  }
  return null;
}

// ── translateAll: returns { kr, th } or null ─────────────────────────────────
async function translateAll(text) {
  var cleanText = text.replace(/https?:\/\/[^\s]+/g, '').trim();
  if (!cleanText) return null;
  text = cleanText;  // Skip if already bilingual (Thai+Korean both present)
    if (THAI_REGEX.test(text) && KOREAN_REGEX.test(text)) return null;

  if (THAI_REGEX.test(text)) {
    console.log('[TR] th->kr');
    var kr = await azureTranslate(text, 'th', 'ko');
    if (!kr) {
      var raw = await aiTranslate(text, SYSTEM_PROMPT_TO_KOREAN + '\n\nTranslate the following Thai text to Korean:');
      kr = raw ? cleanKorean(raw) : null;
    } else {
      kr = cleanKorean(kr);
    }
    if (!kr || !KOREAN_REGEX.test(kr)) return null;
    console.log('[TR] th->kr ok');
    return { kr: kr, th: null };
  }

  if (KOREAN_REGEX.test(text)) {
    console.log('[TR] kr->th');
    var th = await azureTranslate(text, 'ko', 'th');
    if (!th) {
      var raw = await aiTranslate(text, SYSTEM_PROMPT_TO_THAI + '\n\nTranslate the following Korean text to Thai:');
      th = raw ? cleanThai(raw) : null;
    } else {
      th = cleanThai(th);
    }
    if (!th || !THAI_REGEX.test(th)) return null;
    console.log('[TR] kr->th ok');
    return { kr: null, th: th };
  }

  if (ENGLISH_REGEX.test(text) && !THAI_REGEX.test(text) && !KOREAN_REGEX.test(text)) {
    console.log('[TR] en->th');
    var th = await azureTranslate(text, 'en', 'th');
    if (!th) {
      var raw = await aiTranslate(text, SYSTEM_PROMPT_TO_THAI + '\n\nTranslate the following English text to Thai:');
      th = raw ? cleanThai(raw) : null;
    } else {
      th = cleanThai(th);
    }
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
