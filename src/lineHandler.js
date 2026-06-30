/**
 * lineHandler.js — Translation Engine v6
 *
 * v6: Strip @mentions before translation (fix: "@Pond" → no translate)
 * v5: 11-tier cascade, fixed deprecated models, Unicode isBad()
 */
require('dotenv').config();
const crypto = require('crypto');
const axios = require('axios');

const CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET;
const CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const CEREBRAS_API_KEY = process.env.CEREBRAS_API_KEY;
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;

const UJIN_NAME = 'อูจิน (우진)';
const COMPANY = 'Wisdom International';

function verifySignature(body, signature) {
  return crypto.createHmac('SHA256', CHANNEL_SECRET).update(body).digest('base64') === signature;
}

// ── Prompts ───────────────────────────────────────────────────────────────────
const PROMPT_TH_TO_KR = `You are a professional Thai-to-Korean translator.
Translate the Thai message below into natural, conversational Korean.
RULES: Output ONLY the Korean translation. NO explanations. NO word lists. NO Thai characters in output. One paragraph.`;

const PROMPT_KR_TO_TH = `You are a professional Korean-to-Thai translator.
Translate the Korean message below into natural, conversational Thai.
RULES: Output ONLY the Thai translation. NO explanations. NO word lists. NO Korean characters in output. One paragraph.`;

const PROMPT_EN_TO_KR = `Professional English-to-Korean translator.
RULES: Korean translation only. No word lists. No English in output. Natural tone. One paragraph.`;

const PROMPT_EN_TO_TH = `Professional English-to-Thai translator.
RULES: Thai translation only. No word lists. No English in output. Natural tone. One paragraph.`;

// ── Output validator — Unicode escapes to avoid encoding issues ───────────────
function isBad(out, dir) {
  if (!out || out.trim().length < 2) return true;
  if (out.includes('->') || out.includes('\u2192')) return true;
  if (dir === 'th_to_kr' && /[\u0E00-\u0E7F]/.test(out)) return true;
  if (dir === 'kr_to_th' && /[\uAC00-\uD7AF\u1100-\u11FF\u3130-\u318F]/.test(out)) return true;
  return false;
}

// ── API callers ───────────────────────────────────────────────────────────────
const groq = (sys, usr, model) =>
  axios.post('https://api.groq.com/openai/v1/chat/completions',
    { model, messages: [{role:'system',content:sys},{role:'user',content:usr}], temperature: 0.1, max_tokens: 1500 },
    { headers: { Authorization: `Bearer ${GROQ_API_KEY}` }, timeout: 20000 }
  ).then(r => r.data.choices[0].message.content.trim());

const gemini = (sys, usr, model) => {
  if (!GEMINI_API_KEY) return Promise.reject(new Error('No GEMINI_API_KEY'));
  return axios.post(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`,
    { contents: [{parts:[{text: sys + '\n\n' + usr}]}], generationConfig: { temperature: 0.1, maxOutputTokens: 1500 } },
    { timeout: 20000 }
  ).then(r => r.data.candidates[0].content.parts[0].text.trim());
};

const cerebras = (sys, usr) => {
  if (!CEREBRAS_API_KEY) return Promise.reject(new Error('No CEREBRAS_API_KEY'));
  return axios.post('https://api.cerebras.ai/v1/chat/completions',
    { model: 'llama-3.3-70b', messages: [{role:'system',content:sys},{role:'user',content:usr}], temperature: 0.1, max_tokens: 1500 },
    { headers: { Authorization: `Bearer ${CEREBRAS_API_KEY}` }, timeout: 20000 }
  ).then(r => r.data.choices[0].message.content.trim());
};

const openrouter = (sys, usr, model) => {
  if (!OPENROUTER_API_KEY) return Promise.reject(new Error('No OPENROUTER_API_KEY'));
  return axios.post('https://openrouter.ai/api/v1/chat/completions',
    { model, messages: [{role:'system',content:sys},{role:'user',content:usr}], temperature: 0.1, max_tokens: 1500 },
    { headers: { Authorization: `Bearer ${OPENROUTER_API_KEY}`, 'HTTP-Referer':'https://wisdom-ujin.onrender.com','X-Title':'Wisdom Ujin' }, timeout: 20000 }
  ).then(r => r.data.choices[0].message.content.trim());
};

// ── 11-Tier Cascade ───────────────────────────────────────────────────────────
async function translateWithCascade(text, sys, dir) {
  const tiers = [
    { n:'T01:Groq-70b',      f:()=>groq(sys,text,'llama-3.3-70b-versatile') },
    { n:'T02:Gemini-2.0',    f:()=>gemini(sys,text,'gemini-2.0-flash') },
    { n:'T03:Groq-70b-v2',   f:()=>groq(sys,text,'llama-3.1-70b-versatile') },
    { n:'T04:Groq-DeepSeek', f:()=>groq(sys,text,'deepseek-r1-distill-llama-70b') },
    { n:'T05:Groq-Qwen',     f:()=>groq(sys,text,'qwen-qwq-32b') },
    { n:'T06:Groq-Kimi',     f:()=>groq(sys,text,'moonshotai/kimi-k2-instruct') },
    { n:'T07:Gemini-1.5',    f:()=>gemini(sys,text,'gemini-1.5-flash-latest') },
    { n:'T08:Cerebras-70b',  f:()=>cerebras(sys,text) },
    { n:'T09:OR-llama-70b',  f:()=>openrouter(sys,text,'meta-llama/llama-3.3-70b-instruct:free') },
    { n:'T10:OR-gemma2',     f:()=>openrouter(sys,text,'google/gemma-2-9b-it:free') },
    { n:'T11:Groq-8b',       f:()=>groq(sys,text,'llama-3.1-8b-instant') },
  ];
  for (const t of tiers) {
    try {
      const out = await t.f();
      if (!isBad(out, dir)) { console.log('[TR] ok ' + t.n); return out; }
      console.log('[TR] bad ' + t.n + ' (validator rejected)');
    } catch(e) {
      console.log('[TR] err ' + t.n + ': ' + (e.response?.status||e.message?.slice(0,50)));
    }
  }
  throw new Error('All 11 translation tiers failed');
}

// ── Language detection ────────────────────────────────────────────────────────
const THAI_RE    = /[\u0E00-\u0E7F]/;
const KOREAN_RE  = /[\uAC00-\uD7AF\u1100-\u11FF\u3130-\u318F]/;
const ENGLISH_RE = /^[A-Za-z0-9\s\p{P}\p{S}]+$/u;
const MAX_CHARS  = 3000;

/**
 * Strip @Name mentions so they are never translated.
 * e.g. "@Pond สวัสดี" → "สวัสดี"   |   "@Pond" → ""
 */
function stripMentions(text) {
  return text
    .replace(/@[\w\u0E00-\u0E7F\uAC00-\uD7AF\u1100-\u11FF\u3130-\u318F]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

async function translateAll(rawText) {
  // Remove @mentions — translate only actual message content
  const stripped = stripMentions(rawText);
  // Skip very short messages (ครับ, ค่ะ, OK, 네 etc.) — not worth translating
  if (!stripped || stripped.length < 5) {
    console.log('[TR] skip — too short after strip: ' + JSON.stringify(stripped));
    return null;
  }

  const text = stripped.length > MAX_CHARS
    ? stripped.slice(0, MAX_CHARS) + '\n...(truncated)'
    : stripped;

  if (THAI_RE.test(text))   return { kr: await translateWithCascade(text, PROMPT_TH_TO_KR, 'th_to_kr') };
  if (KOREAN_RE.test(text)) return { th: await translateWithCascade(text, PROMPT_KR_TO_TH, 'kr_to_th') };
  if (ENGLISH_RE.test(text) && text.trim().length > 3) {
    const [kr, th] = await Promise.all([
      translateWithCascade(text, PROMPT_EN_TO_KR, 'en_to_kr'),
      translateWithCascade(text, PROMPT_EN_TO_TH, 'en_to_th'),
    ]);
    return { kr, th };
  }
  return null;
}

// ── LINE helpers ──────────────────────────────────────────────────────────────
async function replyMessages(replyToken, messages) {
  if (!replyToken || !messages?.length) return;
  await axios.post('https://api.line.me/v2/bot/message/reply',
    { replyToken, messages },
    { headers: { Authorization: `Bearer ${CHANNEL_ACCESS_TOKEN}`, 'Content-Type': 'application/json' } });
}

async function getSenderName(event) {
  try {
    const uid = event.source?.userId, gid = event.source?.groupId;
    if (!uid) return 'ลูกค้า';
    const url = gid
      ? `https://api.line.me/v2/bot/group/${gid}/member/${uid}`
      : `https://api.line.me/v2/bot/profile/${uid}`;
    const r = await axios.get(url, { headers: { Authorization: `Bearer ${CHANNEL_ACCESS_TOKEN}` } });
    return r.data.displayName ?? 'ลูกค้า';
  } catch { return 'ลูกค้า'; }
}

async function translate(text) { const r = await translateAll(text); return r?.kr ?? null; }

module.exports = { verifySignature, translate, translateAll, translateToKorean: translate, replyMessages, getSenderName, UJIN_NAME, COMPANY };
