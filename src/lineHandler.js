/**
 * lineHandler.js — อูจิน (우진) Translation Engine
 * Cascade: Groq 70b → Gemini 1.5 Flash → Groq 8b
 * Language: Thai ↔ Korean (+ English → both)
 */
require('dotenv').config();
const crypto = require('crypto');
const axios  = require('axios');

const CHANNEL_SECRET       = process.env.LINE_CHANNEL_SECRET;
const CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const GROQ_API_KEY         = process.env.GROQ_API_KEY;
const GEMINI_API_KEY       = process.env.GEMINI_API_KEY; // free: 1M TPM, 15 RPM

// ── Models ────────────────────────────────────────────────────────────────────
const GROQ_70B = 'llama-3.3-70b-versatile'; // tier-1: best quality, 6K TPM free
const GROQ_8B  = 'llama-3.1-8b-instant';    // tier-3: last resort, lower quality

// ── อูจิน Identity ─────────────────────────────────────────────────────────────
const UJIN_NAME = 'อูจิน (우진)';
const COMPANY   = 'Wisdom International';

// ── Signature Verification ────────────────────────────────────────────────────
function verifySignature(body, signature) {
  return crypto.createHmac('SHA256', CHANNEL_SECRET).update(body).digest('base64') === signature;
}

// ── Translation Prompts (strict — no word-lists, no explanations) ─────────────
// CRITICAL: prompts must prevent word-by-word list output from weaker models
const PROMPT_TH_TO_KR = `당신은 전문 태국어-한국어 번역가입니다.
아래 태국어 메시지를 자연스러운 한국어 문장으로 번역하세요.

규칙:
- 번역문만 출력하세요 (설명, 주석, 단어 목록 금지)
- "단어 → 번역" 형식 절대 사용 금지
- 태국어 문자를 출력에 포함하지 마세요
- 원문의 뉘앙스와 구어체를 그대로 살려 자연스럽게 번역하세요
- 한 문단으로 완성된 번역문만 출력하세요`;

const PROMPT_KR_TO_TH = `คุณคือนักแปลภาษาเกาหลี-ไทยมืออาชีพ
แปลข้อความภาษาเกาหลีด้านล่างเป็นภาษาไทยที่เป็นธรรมชาติ

กฎ:
- ส่งออกเฉพาะข้อความที่แปลแล้วเท่านั้น (ห้ามอธิบาย ห้ามแสดงรายการคำศัพท์)
- ห้ามใช้รูปแบบ "คำ → แปล" โดยเด็ดขาด
- ห้ามมีอักษรเกาหลีในผลลัพธ์
- แปลให้เป็นธรรมชาติ รักษาน้ำเสียงและภาษาพูดของต้นฉบับ
- ส่งออกเฉพาะข้อความที่แปลแล้วเป็นย่อหน้าเดียว`;

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
// Detect bad output: word-list pattern, or source language characters still present
function isBadTranslation(output, direction) {
  if (!output) return true;
  if (output.includes('->') || output.includes('→')) return true; // word-list
  if (direction === 'th_to_kr' && /[\u0E00-\u0E7F]/.test(output)) return true; // Thai in KR output
  if (direction === 'kr_to_th' && /[\uAC00-\uD7AF]/.test(output)) return true; // Korean in TH output
  return false;
}

// ── Gemini REST (tier-2 — high quality, 1M TPM, 15 RPM) ──────────────────────
async function geminiTranslate(prompt, userText) {
  if (!GEMINI_API_KEY) throw new Error('No GEMINI_API_KEY');
  const res = await axios.post(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`,
    {
      contents: [{ parts: [{ text: prompt + '\n\n' + userText }] }],
      generationConfig: { temperature: 0.1, maxOutputTokens: 1500 },
    }
  );
  return res.data.candidates[0].content.parts[0].text.trim();
}

// ── Groq REST ─────────────────────────────────────────────────────────────────
async function groqTranslate(text, systemPrompt, model = GROQ_70B) {
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
    { headers: { Authorization: `Bearer ${GROQ_API_KEY}` } }
  );
  return res.data.choices[0].message.content.trim();
}

// ── Core: translate with 3-tier cascade ──────────────────────────────────────
async function translateWithCascade(text, systemPrompt, direction) {
  // Tier-1: Groq 70b
  try {
    const out = await groqTranslate(text, systemPrompt, GROQ_70B);
    if (!isBadTranslation(out, direction)) return out;
    console.log('[Translate] 70b output bad (word-list?) → Gemini');
  } catch (err) {
    const s = err.response?.status;
    if (s !== 429 && s !== 413) throw err;
    console.log('[Translate] 70b quota → Gemini');
  }

  // Tier-2: Gemini 1.5 Flash (good quality, high limits)
  if (GEMINI_API_KEY) {
    try {
      const out = await geminiTranslate(systemPrompt, text);
      if (!isBadTranslation(out, direction)) return out;
      console.log('[Translate] Gemini output bad → 8b');
    } catch (gErr) {
      console.log('[Translate] Gemini failed:', gErr.message, '→ 8b');
    }
  }

  // Tier-3: Groq 8b (last resort)
  const out = await groqTranslate(text, systemPrompt, GROQ_8B);
  return out;
}

// ── Language Detection + Input Cap ───────────────────────────────────────────
const THAI_REGEX    = /[\u0E00-\u0E7F]/;
const KOREAN_REGEX  = /[\uAC00-\uD7AF\u1100-\u11FF\u3130-\u318F]/;
const ENGLISH_REGEX = /^[A-Za-z0-9\s\p{P}\p{S}]+$/u;

// Groq free: 6K TPM. Cap input so input+output < 5K tokens (~3,750 chars input safe).
const MAX_INPUT_CHARS = 3000;

/**
 * translateAll — detect language and translate 24/7
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
    console.log('[Translate] Thai → KR');
    const kr = await translateWithCascade(text, PROMPT_TH_TO_KR, 'th_to_kr');
    return { kr };
  }
  if (KOREAN_REGEX.test(text)) {
    console.log('[Translate] Korean → TH');
    const th = await translateWithCascade(text, PROMPT_KR_TO_TH, 'kr_to_th');
    return { th };
  }
  if (ENGLISH_REGEX.test(text) && text.trim().length > 1) {
    console.log('[Translate] English → KR+TH');
    const [kr, th] = await Promise.all([
      translateWithCascade(text, PROMPT_EN_TO_KR, 'en_to_kr'),
      translateWithCascade(text, PROMPT_EN_TO_TH, 'en_to_th'),
    ]);
    return { kr, th };
  }
  return null;
}

// ── LINE Reply ────────────────────────────────────────────────────────────────
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

// ── Legacy alias ──────────────────────────────────────────────────────────────
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
