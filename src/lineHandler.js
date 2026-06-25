/**
 * lineHandler.js
 * บอทอูจิน (우진) — ผู้ช่วยสื่อสารของ Wisdom International
 * หน้าที่: แปลภาษา TH↔KR↔EN, สรุปบทสนทนา, แจ้งเตือนนอกเวลา
 */
require('dotenv').config();
const crypto = require('crypto');
const axios  = require('axios');

const CHANNEL_SECRET       = process.env.LINE_CHANNEL_SECRET;
const CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const GROQ_API_KEY         = process.env.GROQ_API_KEY;
const GROQ_MODEL           = 'llama-3.3-70b-versatile';

// ── อูจิน Identity ───────────────────────────────────────────────────────────
const UJIN_NAME = 'อูจิน (우진)';
const COMPANY   = 'Wisdom International';

const OOO_MESSAGE =
  `⏰ ขณะนี้นอกเวลาทำงานครับ\n` +
  `— ${UJIN_NAME} | ${COMPANY}\n\n` +
  `📋 ข้อความของคุณถูกบันทึกไว้แล้ว\n` +
  `ทีมงานจะติดต่อกลับในเวลาทำการ (จ–ศ 08:00–18:00) ครับ 🙏\n\n` +
  `비즈니스 시간 외입니다. 메시지가 기록되었으며 업무 시간에 연락드리겠습니다.`;

// ── Signature Verification ───────────────────────────────────────────────────
function verifySignature(body, signature) {
  const hash = crypto
    .createHmac('SHA256', CHANNEL_SECRET)
    .update(body)
    .digest('base64');
  return hash === signature;
}

// ── Groq AI Translation ───────────────────────────────────────────────────────
async function groqTranslate(text, systemPrompt) {
  const res = await axios.post(
    'https://api.groq.com/openai/v1/chat/completions',
    {
      model: GROQ_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user',   content: text },
      ],
      temperature:  0.3,
      max_tokens:  512,
    },
    { headers: { Authorization: `Bearer ${GROQ_API_KEY}` } }
  );
  return res.data.choices[0].message.content.trim();
}

// ── Language Detection ────────────────────────────────────────────────────────
const THAI_REGEX    = /[฀-๿]/;
const KOREAN_REGEX  = /[가-힯ᄀ-ᇿ㄰-㆏]/;
const ENGLISH_REGEX = /^[A-Za-z0-9sp{P}p{S}]+$/u;

/**
 * translateAll — detect language and translate
 *   Thai    → Korean only
 *   Korean  → Thai only
 *   English → Korean + Thai (parallel)
 * @returns { kr?, th? } or null if no translation needed
 */
async function translateAll(text) {
  if (THAI_REGEX.test(text)) {
    const kr = await groqTranslate(
      text,
      'You are ${UJIN_NAME}, a professional bilingual assistant at ${COMPANY}. ' +
      'Output ONLY the Korean (한국어) translation of the user\'s message. No explanation.'
    );
    return { kr };
  }
  if (KOREAN_REGEX.test(text)) {
    const th = await groqTranslate(
      text,
      'You are ${UJIN_NAME}, a professional bilingual assistant at ${COMPANY}. ' +
      'Output ONLY the Thai (ภาษาไทย) translation of the user\'s message. No explanation.'
    );
    return { th };
  }
  if (ENGLISH_REGEX.test(text) && text.trim().length > 1) {
    const [kr, th] = await Promise.all([
      groqTranslate(
        text,
        'You are ${UJIN_NAME}, a professional bilingual assistant at ${COMPANY}. ' +
        'Output ONLY the Korean (한국어) translation. No explanation.'
      ),
      groqTranslate(
        text,
        'You are ${UJIN_NAME}, a professional bilingual assistant at ${COMPANY}. ' +
        'Output ONLY the Thai (ภาษาไทย) translation. No explanation.'
      ),
    ]);
    return { kr, th };
  }
  return null;
}

// ── LINE Reply ────────────────────────────────────────────────────────────────
async function replyMessages(replyToken, messages) {
  if (!replyToken || !messages?.length) return;
  await axios.post(
    'https://api.line.me/v2/bot/reply',
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
    const res = await axios.get(url, {
      headers: { Authorization: `Bearer ${CHANNEL_ACCESS_TOKEN}` },
    });
    return res.data.displayName ?? 'ลูกค้า';
  } catch {
    return 'ลูกค้า';
  }
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
  OOO_MESSAGE,
  UJIN_NAME,
  COMPANY,
};
