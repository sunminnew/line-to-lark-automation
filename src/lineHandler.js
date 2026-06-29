/**
 * lineHandler.js — อูจิน (우진) Translation Engine
 *
 * 6-tier cascade (all FREE, separate quota pools):
 *  Tier 1: Groq  llama-3.3-70b-versatile   →  6K TPM, best quality
 *  Tier 2: Gemini 1.5 Flash                →  1M TPM, excellent quality
 *  Tier 3: Gemini 2.0 Flash                →  4M TPM, very fast
 *  Tier 4: Groq  mixtral-8x7b-32768        →  5K TPM, own quota pool
 *  Tier 5: Groq  gemma2-9b-it              → 14K TPM, own quota pool
 *  Tier 6: Groq  llama-3.1-8b-instant      →  6K TPM, last resort
 *
 * → ระบบแปลจะไม่หยุดอีกต่อไป
 */
require('dotenv').config();
const crypto = require('crypto');
const axios  = require('axios');

const CHANNEL_SECRET       = process.env.LINE_CHANNEL_SECRET;
const CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const GROQ_API_KEY         = process.env.GROQ_API_KEY;
const GEMINI_API_KEY       = process.env.GEMINI_API_KEY; // aistudio.google.com/apikey (free)

// ── Identity ──────────────────────────────────────────────────────────────────
const UJIN_NAME = 'อูจิน (우진)';
const COMPANY   = 'Wisdom International';

// ── Groq Models (each has its own TPM quota pool) ────────────────────────────
const GROQ_MODELS = [
  'llama-3.3-70b-versatile',  // Tier 1 — 6K TPM, highest quality
  'mixtral-8x7b-32768',        // Tier 4 — 5K TPM, good quality
  'gemma2-9b-it',              // Tier 5 — 14K TPM, fast
  'llama-3.1-8b-instant',      // Tier 6 — 6K TPM, last resort
];

// ── Gemini Models (each has its own quota) ───────────────────────────────────
const GEMINI_MODELS = [
  { name: 'gemini-1.5-flash',   maxTokens: 1500 }, // Tier 2 — 1M TPM
  { name: 'gemini-2.0-flash',   maxTokens: 1500 }, // Tier 3 — 4M TPM
];

// ── Signature ─────────────────────────────────────────────────────────────────
function verifySignature(body, signature) {
  return crypto.createHmac('SHA256', CHANNEL_SECRET).update(body).digest('base64') === signature;
}

// ── Translation Prompts (strict — natural sentences only, no word-lists) ──────
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

Rules:
- Output ONLY the Korean translation
- Do NOT use "word → translation" lists
- Do NOT include English text in the output
- Translate naturally, preserving the original tone and colloquial style
- Output a single complete paragraph`;

const PROMPT_EN_TO_TH = `You are a professional English-to-Thai translator.
Translate the English message below into natural Thai.

Rules:
- Output ONLY the Thai translation
- Do NOT use "word → translation" lists
- Do NOT include English text in the output
- Translate naturally, preserving the original tone and colloquial style
- Output a single complete paragraph`;

// ── Output Validator ──────────────────────────────────────────────────────────
function isBadTranslation(output, direction) {
  if (!output || output.trim().length < 2) return true;
  if (output.includes('->') || output.includes('→')) return true;
  if (direction === 'th_to_kr' && /[\u0E00-\u0E7F]/.test(output)) return true;
  if (direction === 'kr_to_th' && /[\uAC00-\uD7AF]/.test(output)) return true;
  return false;
}

// ── Gemini REST ────────────────────────────────────────────────────────────────
async function geminiTranslate(prompt, userText, modelName, maxTokens = 1500) {
  if (!GEMINI_API_KEY) throw new Error('No GEMINI_API_KEY');
  const res = await axios.post(
    `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${GEMINI_API_KEY}`,
    {
      contents: [{ parts: [{ text: prompt + '\n\n' + userText }] }],
      generationConfig: { temperature: 0.1, maxOutputTokens: maxTokens },
    },
    { timeout: 20000 }
  );
  return res.data.candidates[0].content.parts[0].text.trim();
}

// ── Groq REST ──────────────────────────────────────────────────────────────────
async function groqTranslate(text, systemPrompt, model) {
  const res = await axios.post(
    'https://api.groq.com/openai/v1/chat/completions',
    {
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user',   content: text },
      ],
      temperature: 0.1,
      max_tokens: 1500,
    },
    {
      headers: { Authorization: `Bearer ${GROQ_API_KEY}` },
      timeout: 20000,
    }
  );
  return res.data.choices[0].message.content.trim();
}

// ── 6-Tier Cascade ─────────────────────────────────────────────────────────────
async function translateWithCascade(text, systemPrompt, direction) {
  const isQuotaErr = (err) => {
    const s = err.response?.status;
    return s === 429 || s === 413 || s === 503;
  };

  // Tier 1: Groq llama-3.3-70b (best quality)
  try {
    const out = await groqTranslate(text, systemPrompt, GROQ_MODELS[0]);
    if (!isBadTranslation(out, direction)) { console.log('[T1:Groq-70b] ✓'); return out; }
    console.log('[T1:Groq-70b] bad output → next');
  } catch (e) {
    if (!isQuotaErr(e)) throw e;
    console.log('[T1:Groq-70b] quota →', e.response?.status);
  }

  // Tier 2: Gemini 1.5 Flash (1M TPM free)
  if (GEMINI_API_KEY) {
    try {
      const out = await geminiTranslate(systemPrompt, text, 'gemini-1.5-flash');
      if (!isBadTranslation(out, direction)) { console.log('[T2:Gemini-1.5] ✓'); return out; }
      console.log('[T2:Gemini-1.5] bad output → next');
    } catch (e) {
      console.log('[T2:Gemini-1.5]', e.response?.status ?? e.message, '→ next');
    }

    // Tier 3: Gemini 2.0 Flash (4M TPM free)
    try {
      const out = await geminiTranslate(systemPrompt, text, 'gemini-2.0-flash');
      if (!isBadTranslation(out, direction)) { console.log('[T3:Gemini-2.0] ✓'); return out; }
      console.log('[T3:Gemini-2.0] bad output → next');
    } catch (e) {
      console.log('[T3:Gemini-2.0]', e.response?.status ?? e.message, '→ next');
    }
  }

  // Tier 4: Groq Mixtral-8x7b (own 5K TPM pool)
  try {
    const out = await groqTranslate(text, systemPrompt, GROQ_MODELS[1]);
    if (!isBadTranslation(out, direction)) { console.log('[T4:Mixtral] ✓'); return out; }
    console.log('[T4:Mixtral] bad output → next');
  } catch (e) {
    if (!isQuotaErr(e)) throw e;
    console.log('[T4:Mixtral] quota →', e.response?.status);
  }

  // Tier 5: Groq Gemma2-9b (own 14K TPM pool — highest Groq TPM)
  try {
    const out = await groqTranslate(text, systemPrompt, GROQ_MODELS[2]);
    if (!isBadTranslation(out, direction)) { console.log('[T5:Gemma2-9b] ✓'); return out; }
    console.log('[T5:Gemma2-9b] bad output → next');
  } catch (e) {
    if (!isQuotaErr(e)) throw e;
    console.log('[T5:Gemma2-9b] quota →', e.response?.status);
  }

  // Tier 6: Groq 8b (last resort)
  console.log('[T6:Groq-8b] last resort');
  const out = await groqTranslate(text, systemPrompt, GROQ_MODELS[3]);
  return out;
}

// ── Language Detection + Input Cap ────────────────────────────────────────────
const THAI_REGEX    = /[\u0E00-\u0E7F]/;
const KOREAN_REGEX  = /[\uAC00-\uD7AF\u1100-\u11FF\u3130-\u318F]/;
const ENGLISH_REGEX = /^[A-Za-z0-9\s\p{P}\p{S}]+$/u;
const MAX_INPUT_CHARS = 3000;

/**
 * translateAll — detect language and route to correct cascade
 * Thai    → Korean only
 * Korean  → Thai only
 * English → Korean + Thai (parallel)
 * @returns { kr?, th? } or null
 */
async function translateAll(rawText) {
  const text = rawText.length > MAX_INPUT_CHARS
    ? rawText.slice(0, MAX_INPUT_CHARS) + '\n…(ข้อความยาวเกิน ระบบแปลเฉพาะส่วนแรก)'
    : rawText;

  if (THAI_REGEX.test(text)) {
    console.log('[translateAll] Thai → KR');
    const kr = await translateWithCascade(text, PROMPT_TH_TO_KR, 'th_to_kr');
    return { kr };
  }
  if (KOREAN_REGEX.test(text)) {
    console.log('[translateAll] Korean → TH');
    const th = await translateWithCascade(text, PROMPT_KR_TO_TH, 'kr_to_th');
    return { th };
  }
  if (ENGLISH_REGEX.test(text) && text.trim().length > 1) {
    console.log('[translateAll] English → KR+TH');
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
    { headers: { Authorization: `Bearer ${CHANNEL_ACCESS_TOKEN}`, 'Content-Type': 'application/json' } }
  );
}

// ── Get Sender Name ───────────────────────────────────────────────────────────
async function getSenderName(event) {
  try {
    const userId  = event.source?.userId;
    const groupId = event.source?.groupId;
    if (!userId) return 'ลูกค้า';
    const url = groupId
      ? `https://api.line.me/v2/bot/group/${groupId}/member/${userId}`
      : `https://api.line.me/v2/bot/profile/${userId}`;
    const res = await axios.get(url, { headers: { Authorization: `Bearer ${CHANNEL_ACCESS_TOKEN}` } });
    return res.data.displayName ?? 'ลูกค้า';
  } catch { return 'ลูกค้า'; }
}

// ── Legacy alias ───────────────────────────────────────────────────────────────
async function translate(text) {
  const r = await translateAll(text);
  return r?.kr ?? null;
}

module.exports = {
  verifySignature,
  translate,
  translateAll,
  translateToKorean: translate,
  replyMessages,
  getSenderName,
  UJIN_NAME,
  COMPANY,
};
