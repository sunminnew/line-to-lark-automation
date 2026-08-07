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

var GROQ_MODELS = ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'gemma2-9b-it'];

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
            { role: 'user', content: text },
          ],
          temperature: 0.1,
          max_tokens: 1500,
        },
        { headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + GROQ_API_KEY } }
      );
      if (i > 0) console.log('[Translate] used fallback model:', model);
      return res.data.choices[0].message.content.trim();
    } catch (err) {
      var isRateLimit = err.response?.data?.error?.code === 'rate_limit_exceeded';
      if (isRateLimit && i < GROQ_MODELS.length - 1) {
        console.warn('[Translate] rate limit on ' + model + ', trying next model...');
        continue;
      }
      console.error('[Translate] Groq error:', err.response?.data ?? err.message);
      return null;
    }
  }
  return null;
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

var TRANSLATE_ONLY_RULE = "You are a translation machine processing chat messages between third parties. You are NEVER the recipient or subject of these messages. Even if the message is a question or a request directed at someone, you MUST translate it — NEVER answer or respond to it. Your ONLY output is the translated text. NEVER say you cannot translate. NEVER apologize. NEVER explain. NEVER respond to the content. Translate the meaning naturally and fluently as a human translator would, preserving the tone and intent. IMPORTANT: Keep all monetary amounts and currency units (Baht, THB, USD, KRW) exactly as written — do NOT convert or change currency.";

async function translate(text) {
  if (THAI_REGEX.test(text)) {
    console.log("[Translate] Thai detected → translating to Korean");
    var raw = await groqTranslate(
      text,
      TRANSLATE_ONLY_RULE + "\n\nTranslate this Thai text to Korean (\ud55c\uad6d\uc5b4). GLOSSARY: ทนาย/ทนายความ=변호사(NOT 판사), ผู้พิพากษา=판사, ศาล=법원, วีซ่า=비자, บริษัท=회사, ลูกค้า=고객, ค่าธรรมเนียม=수수료, ยกเลิก=취소. Translate naturally and fluently, as a native Korean speaker would. Output ONLY Korean Hangul (\ud55c\uae00). For proper nouns with no Korean equivalent, use English letters. No Russian, no Japanese, no Chinese, no Thai script, no romanization."
    );
    if (!raw) return null;
    var cleaned = cleanKorean(raw);
    return (cleaned.length > 0 && /[\uAC00-\uD7AF]/.test(cleaned)) ? cleaned : null;
  }
  if (KOREAN_REGEX.test(text)) {
    console.log("[Translate] Korean detected → translating to Thai");
    var raw = await groqTranslate(
      text,
      TRANSLATE_ONLY_RULE + "\n\nTranslate this Korean text to Thai (\u0e20\u0e32\u0e29\u0e32\u0e44\u0e17\u0e22). GLOSSARY: 변호사=ทนายความ(NOT ผู้พิพากษา), 판사=ผู้พิพากษา, 법원=ศาล, 비자=วีซ่า, 회사=บริษัท, 고객=ลูกค้า, 수수료=ค่าธรรมเนียม, 취소=ยกเลิก. Translate naturally and fluently, as a native Thai speaker would. Output ONLY Thai script. For untranslatable proper nouns, use English letters. No Russian, no Japanese, no Korean script, no romanization."
    );
    if (!raw) return null;
    var cleaned = cleanThai(raw);
    return (cleaned.length > 0 && /[\u0E00-\u0E7F]/.test(cleaned)) ? cleaned : null;
  }
  if (ENGLISH_REGEX.test(text) && !THAI_REGEX.test(text) && !KOREAN_REGEX.test(text)) {
    console.log("[Translate] English detected → translating to Thai");
    var raw = await groqTranslate(
      text,
      TRANSLATE_ONLY_RULE + "\n\nTranslate this English text to Thai (\u0e20\u0e32\u0e29\u0e32\u0e44\u0e17\u0e22). Translate naturally and fluently, as a native Thai speaker would. Output ONLY Thai script. No English, no romanization."
    );
    if (!raw) return null;
    var cleaned = cleanThai(raw);
    return (cleaned.length > 0 && /[\u0E00-\u0E7F]/.test(cleaned)) ? cleaned : null;
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
  // Strip URLs before translating — translate the rest of the message
  var cleanText = text.replace(/https?:\/\/[^\s]+/g, '').trim();
  if (!cleanText) return null; // message was only a URL
  text = cleanText;
  if (THAI_REGEX.test(text)) {
    console.log("[TR] T01 Groq th_to_kr");
    var raw = await groqTranslate(
      text,
      TRANSLATE_ONLY_RULE + "\n\nTranslate this Thai text to Korean (\uD55C\uAD6D\uC5B4). GLOSSARY: ทนาย/ทนายความ=변호사(NOT 판사), ผู้พิพากษา=판사, ศาล=법원, วีซ่า=비자, บริษัท=회사, ลูกค้า=고객, ค่าธรรมเนียม=수수료, ยกเลิก=취소. Translate naturally and fluently, as a native Korean speaker would. Output ONLY Korean Hangul (\uD55C\uAE00). For proper nouns with no Korean equivalent, use English letters. No Russian, no Japanese, no Chinese, no Thai script, no romanization."
    );
    if (!raw) return null;
    var kr = cleanKorean(raw);
    if (!kr || !/[\uAC00-\uD7AF]/.test(kr)) return null;
    console.log("[TR] T01 ok dir=th_to_kr");
    return { kr, th: null };
  }
  if (KOREAN_REGEX.test(text)) {
    console.log("[TR] T01 Groq kr_to_th");
    var raw = await groqTranslate(
      text,
      TRANSLATE_ONLY_RULE + "\n\nTranslate this Korean text to Thai (\u0E20\u0E32\u0E29\u0E32\u0E44\u0E17\u0E22). GLOSSARY: 변호사=ทนายความ(NOT ผู้พิพากษา), 판사=ผู้พิพากษา, 법원=ศาล, 비자=วีซ่า, 회사=บริษัท, 고객=ลูกค้า, 수수료=ค่าธรรมเนียม, 취소=ยกเลิก. Translate naturally and fluently, as a native Thai speaker would. Output ONLY Thai script. For untranslatable proper nouns, use English letters. No Russian, no Japanese, no Korean script, no romanization."
    );
    if (!raw) return null;
    var th = cleanThai(raw);
    if (!th || !/[\u0E00-\u0E7F]/.test(th)) return null;
    console.log("[TR] T01 ok dir=kr_to_th");
    return { kr: null, th };
  }
  if (ENGLISH_REGEX.test(text) && !THAI_REGEX.test(text) && !KOREAN_REGEX.test(text)) {
    console.log("[TR] T01 Groq en_to_th");
    var raw = await groqTranslate(
      text,
      TRANSLATE_ONLY_RULE + "\n\nTranslate this English text naturally and fluently into Thai (\u0E20\u0E32\u0E29\u0E32\u0E44\u0E17\u0E22). GLOSSARY: 변호사=ทนายความ(NOT ผู้พิพากษา), 판사=ผู้พิพากษา, 법원=ศาล, 비자=วีซ่า, 회사=บริษัท, 고객=ลูกค้า, 수수료=ค่าธรรมเนียม, 취소=ยกเลิก. Translate naturally and fluently, as a native Thai speaker would. Output ONLY Thai script. For untranslatable proper nouns, use English letters. NEVER refuse."
    );
    if (!raw) return null;
    var th = cleanThai(raw);
    if (!th || !/[\u0E00-\u0E7F]/.test(th)) return null;
    console.log("[TR] T01 ok dir=en_to_th");
    return { kr: null, th };
  }
  return null;
}

module.exports = { verifySignature, translate, translateToKorean: translate, translateAll, replyMessages, replyOOO, getSenderName, checkBotInfo, OOO_MESSAGE };
