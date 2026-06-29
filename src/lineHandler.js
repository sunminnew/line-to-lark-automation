/**
 * lineHandler.js — อูจิน (우진) Translation Engine
 *
 * 8-tier translation cascade (all FREE, independent quota pools):
 *  T1: Groq llama-3.3-70b      —  6K TPM  best quality
 *  T2: Gemini 1.5 Flash        —  1M TPM  excellent
 *  T3: Gemini 2.0 Flash        —  4M TPM
 *  T4: Cerebras llama-3.3-70b  — 60K TPM  blazing fast
 *  T5: OpenRouter 70b:free     — free     separate pool
 *  T6: Groq Mixtral-8x7b       —  5K TPM
 *  T7: Groq Gemma2-9b          — 14K TPM
 *  T8: Groq llama-3.1-8b       —  6K TPM  last resort
 */
require('dotenv').config();
const crypto = require('crypto');
const axios  = require('axios');

const CHANNEL_SECRET       = process.env.LINE_CHANNEL_SECRET;
const CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const GROQ_API_KEY         = process.env.GROQ_API_KEY;
const GEMINI_API_KEY       = process.env.GEMINI_API_KEY;
const CEREBRAS_API_KEY     = process.env.CEREBRAS_API_KEY;   // cerebras.ai (free)
const OPENROUTER_API_KEY   = process.env.OPENROUTER_API_KEY; // openrouter.ai (free)

const UJIN_NAME = 'อูจิน (우진)';
const COMPANY   = 'Wisdom International';

// ── Signature ─────────────────────────────────────────────────────────────────
function verifySignature(body, signature) {
  return crypto.createHmac('SHA256', CHANNEL_SECRET).update(body).digest('base64') === signature;
}

// ── Translation Prompts (strict — natural sentences, no word-lists) ────────────
const PROMPT_TH_TO_KR = `당신은 전문 태국어-한국어 번역가입니다.
아래 태국어 메시지를 자연스러운 한국어 문장으로 번역하세요.

규칙:
- 번역문만 출력하세요 (설명, 주석, 단어 목록 금지)
- "단어 → 번역" 형식 절대 사용 금지
- 태국어 문자를 출력에 포함하지 마세요
- 구어체와 뉘앙스를 그대로 살려 자연스럽게 번역하세요
- 한 문단으로 완성된 번역문만 출력하세요`;

const PROMPT_KR_TO_TH = `คุณคือนักแปลภาษาเกาหลี-ไทยมืออาชีพ
แปลข้อความภาษาเกาหลีด้านล่างเป็นภาษาไทยที่เป็นธรรมชาติ

กฎ:
- ส่งออกเฉพาะข้อความที่แปลแล้วเท่านั้น (ห้ามอธิบาย ห้ามแสดงรายการคำศัพท์)
- ห้ามใช้รูปแบบ "คำ → แปล" โดยเด็ดขาด
- ห้ามมีอักษรเกาหลีในผลลัพธ์
- แปลให้เป็นธรรมชาติ รักษาน้ำเสียงและภาษาพูดของต้นฉบับ
- ส่งออกเฉพาะข้อความแปลเป็นย่อหน้าเดียว`;

const PROMPT_EN_TO_KR = `You are a professional English-to-Korean translator.
Translate the English message below into natural Korean.
Rules: Output ONLY the Korean translation. No word lists. No English in output.
Translate naturally, preserving tone. Single paragraph only.`;

const PROMPT_EN_TO_TH = `You are a professional English-to-Thai translator.
Translate the English message below into natural Thai.
Rules: Output ONLY the Thai translation. No word lists. No English in output.
Translate naturally, preserving tone. Single paragraph only.`;

// ── Output Validator ──────────────────────────────────────────────────────────
function isBadTranslation(output, direction) {
  if (!output || output.trim().length < 2) return true;
  if (output.includes('->') || output.includes('→')) return true;
  if (direction === 'th_to_kr' && /[\u0E00-\u0E7F]/.test(output)) return true;
  if (direction === 'kr_to_th' && /[\uAC00-\uD7AF]/.test(output)) return true;
  return false;
}

// ── Tier Callers ───────────────────────────────────────────────────────────────
function isQuotaErr(err) { const s = err.response?.status; return s===429||s===413||s===503; }

const callGroq = (sys, usr, model) =>
  axios.post('https://api.groq.com/openai/v1/chat/completions',
    { model, messages:[{role:'system',content:sys},{role:'user',content:usr}], temperature:0.1, max_tokens:1500 },
    { headers:{Authorization:`Bearer ${GROQ_API_KEY}`}, timeout:20000 }
  ).then(r => r.data.choices[0].message.content.trim());

const callGemini = (sys, usr, model) => {
  if (!GEMINI_API_KEY) return Promise.reject(new Error('No GEMINI_API_KEY'));
  return axios.post(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`,
    { contents:[{parts:[{text:sys+'\n\n'+usr}]}], generationConfig:{temperature:0.1,maxOutputTokens:1500} },
    { timeout:20000 }
  ).then(r => r.data.candidates[0].content.parts[0].text.trim());
};

const callCerebras = (sys, usr) => {
  if (!CEREBRAS_API_KEY) return Promise.reject(new Error('No CEREBRAS_API_KEY'));
  return axios.post('https://api.cerebras.ai/v1/chat/completions',
    { model:'llama-3.3-70b', messages:[{role:'system',content:sys},{role:'user',content:usr}], temperature:0.1, max_tokens:1500 },
    { headers:{Authorization:`Bearer ${CEREBRAS_API_KEY}`}, timeout:20000 }
  ).then(r => r.data.choices[0].message.content.trim());
};

const callOpenRouter = (sys, usr) => {
  if (!OPENROUTER_API_KEY) return Promise.reject(new Error('No OPENROUTER_API_KEY'));
  return axios.post('https://openrouter.ai/api/v1/chat/completions',
    { model:'meta-llama/llama-3.3-70b-instruct:free',
      messages:[{role:'system',content:sys},{role:'user',content:usr}], temperature:0.1, max_tokens:1500 },
    { headers:{Authorization:`Bearer ${OPENROUTER_API_KEY}`,
        'HTTP-Referer':'https://wisdom-ujin.onrender.com','X-Title':'Wisdom อูจิน AI'}, timeout:20000 }
  ).then(r => r.data.choices[0].message.content.trim());
};

// ── 8-Tier Translation Cascade ────────────────────────────────────────────────
async function translateWithCascade(text, systemPrompt, direction) {
  const tiers = [
    { name:'T1:Groq-70b',      fn:() => callGroq(systemPrompt, text, 'llama-3.3-70b-versatile') },
    { name:'T2:Gemini-1.5',    fn:() => callGemini(systemPrompt, text, 'gemini-1.5-flash') },
    { name:'T3:Gemini-2.0',    fn:() => callGemini(systemPrompt, text, 'gemini-2.0-flash') },
    { name:'T4:Cerebras-70b',  fn:() => callCerebras(systemPrompt, text) },
    { name:'T5:OpenRouter-70b',fn:() => callOpenRouter(systemPrompt, text) },
    { name:'T6:Groq-Mixtral',  fn:() => callGroq(systemPrompt, text, 'mixtral-8x7b-32768') },
    { name:'T7:Groq-Gemma2',   fn:() => callGroq(systemPrompt, text, 'gemma2-9b-it') },
    { name:'T8:Groq-8b',       fn:() => callGroq(systemPrompt, text, 'llama-3.1-8b-instant') },
  ];

  for (const tier of tiers) {
    try {
      const out = await tier.fn();
      if (!isBadTranslation(out, direction)) { console.log(`[TR] ✓ ${tier.name}`); return out; }
      console.log(`[TR] ${tier.name} bad output → next`);
    } catch (err) {
      const r = isQuotaErr(err) ? `quota(${err.response?.status})`
              : err.message?.startsWith('No ') ? 'no key' : err.message?.slice(0,40);
      console.log(`[TR] ${tier.name} ${r} → next`);
    }
  }
  throw new Error('All 8 translation tiers failed');
}

// ── Language Detection + Input Cap ────────────────────────────────────────────
const THAI_REGEX    = /[\u0E00-\u0E7F]/;
const KOREAN_REGEX  = /[\uAC00-\uD7AF\u1100-\u11FF\u3130-\u318F]/;
const ENGLISH_REGEX = /^[A-Za-z0-9\s\p{P}\p{S}]+$/u;
const MAX_INPUT_CHARS = 3000;

async function translateAll(rawText) {
  const text = rawText.length > MAX_INPUT_CHARS
    ? rawText.slice(0, MAX_INPUT_CHARS) + '\n…(ข้อความยาวเกิน ระบบแปลเฉพาะส่วนแรก)'
    : rawText;

  if (THAI_REGEX.test(text)) {
    const kr = await translateWithCascade(text, PROMPT_TH_TO_KR, 'th_to_kr');
    return { kr };
  }
  if (KOREAN_REGEX.test(text)) {
    const th = await translateWithCascade(text, PROMPT_KR_TO_TH, 'kr_to_th');
    return { th };
  }
  if (ENGLISH_REGEX.test(text) && text.trim().length > 1) {
    const [kr, th] = await Promise.all([
      translateWithCascade(text, PROMPT_EN_TO_KR, 'en_to_kr'),
      translateWithCascade(text, PROMPT_EN_TO_TH, 'en_to_th'),
    ]);
    return { kr, th };
  }
  return null;
}

// ── LINE Reply ─────────────────────────────────────────────────────────────────
async function replyMessages(replyToken, messages) {
  if (!replyToken || !messages?.length) return;
  await axios.post(
    'https://api.line.me/v2/bot/message/reply',
    { replyToken, messages },
    { headers:{ Authorization:`Bearer ${CHANNEL_ACCESS_TOKEN}`, 'Content-Type':'application/json' } }
  );
}

async function getSenderName(event) {
  try {
    const userId  = event.source?.userId;
    const groupId = event.source?.groupId;
    if (!userId) return 'ลูกค้า';
    const url = groupId
      ? `https://api.line.me/v2/bot/group/${groupId}/member/${userId}`
      : `https://api.line.me/v2/bot/profile/${userId}`;
    const res = await axios.get(url, { headers:{ Authorization:`Bearer ${CHANNEL_ACCESS_TOKEN}` } });
    return res.data.displayName ?? 'ลูกค้า';
  } catch { return 'ลูกค้า'; }
}

async function translate(text) { const r = await translateAll(text); return r?.kr ?? null; }

module.exports = { verifySignature, translate, translateAll, translateToKorean:translate, replyMessages, getSenderName, UJIN_NAME, COMPANY };
