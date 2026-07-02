/**
 * aiSummarizer.js — วิสดอม Summary Brain v2
 *
 * FIX: Groq เป็น T01 (เร็ว เสถียร) ไม่ต้องรอ Gemini timeout ก่อน
 * FIX: เอา mixtral-8x7b + gemma2-9b ออก (deprecated → 400)
 * FIX: timeout ต่อ call = 12s (ให้ทัน 25s window ของ server.js)
 * EXPORT: summarizeForLark ใช้ทั้ง server.js และ cronJob.js
 */
require('dotenv').config();
const axios = require('axios');

const GROQ_API_KEY       = process.env.GROQ_API_KEY;
const GEMINI_API_KEY     = process.env.GEMINI_API_KEY;
const CEREBRAS_API_KEY   = process.env.CEREBRAS_API_KEY;
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;

// ── Context-aware prompts ─────────────────────────────────────────────────────
function buildPrompt(mode, messages) {
  const msgText = messages.map(m=>`[${m.senderName||m.sender||'?'}]: ${m.text||''}`).join('\n');
  const MAX = 6000;
  const body = msgText.length > MAX ? msgText.slice(0, MAX) + '\n...(ตัดส่วนเกิน)' : msgText;

  const map = {
    evening: {
      sys: 'คุณคือวิสดอม (위즈덤) AI ของ Wisdom International วิเคราะห์บทสนทนาทั้งวันอย่างลึกซึ้ง ตอบเป็นภาษาไทย',
      user: `บทสนทนาทั้งวัน:\n${body}\n\nสรุปในรูปแบบ:\n📊 ภาพรวมวันนี้\n🎯 ประเด็นหลัก\n⏳ งานค้าง\n✅ สิ่งที่สำเร็จ\n⚠️ ปัญหา/ความเสี่ยง\n📋 To-do พรุ่งนี้`,
      tok: 2000,
    },
    morning: {
      sys: 'คุณคือวิสดอม (위즈덤) AI ของ Wisdom International',
      user: `ข้อความนอกเวลางาน:\n${body}\n\nสรุปสั้น: งานค้าง, สิ่งต้องทำ, ข้อมูลสำคัญ`,
      tok: 1000,
    },
    pipeline: {
      sys: 'คุณคือวิสดอม (위즈덤) วิเคราะห์บทสนทนาธุรกิจ ตอบกระชับ',
      user: `ข้อความ:\n${body}\n\nสรุปประเด็นสำคัญ งานค้าง สิ่งต้องติดตาม`,
      tok: 800,
    },
    default: {
      sys: 'คุณคือวิสดอม (위즈덤) AI ของ Wisdom International',
      user: `ข้อความ:\n${body}\n\nสรุปประเด็นสำคัญ:`,
      tok: 800,
    },
  };
  return map[mode] || map.default;
}

// ── API callers (timeout 12s ต่อ call เพื่อให้ทัน 25s window) ────────────────
const groq = (sys,usr,model,tok) =>
  axios.post('https://api.groq.com/openai/v1/chat/completions',
    {model, messages:[{role:'system',content:sys},{role:'user',content:usr}], temperature:0.3, max_tokens:tok},
    {headers:{Authorization:`Bearer ${GROQ_API_KEY}`}, timeout:12000}
  ).then(r=>r.data.choices[0].message.content.trim());

const gemini = (sys,usr,model,tok) => {
  if(!GEMINI_API_KEY) return Promise.reject(new Error('No GEMINI_API_KEY'));
  return axios.post(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`,
    {contents:[{parts:[{text:sys+'\n\n'+usr}]}], generationConfig:{temperature:0.3,maxOutputTokens:tok}},
    {timeout:12000}
  ).then(r=>r.data.candidates[0].content.parts[0].text.trim());
};

const cerebras = (sys,usr,tok) => {
  if(!CEREBRAS_API_KEY) return Promise.reject(new Error('No CEREBRAS_API_KEY'));
  return axios.post('https://api.cerebras.ai/v1/chat/completions',
    {model:'llama-3.3-70b', messages:[{role:'system',content:sys},{role:'user',content:usr}], temperature:0.3, max_tokens:tok},
    {headers:{Authorization:`Bearer ${CEREBRAS_API_KEY}`}, timeout:12000}
  ).then(r=>r.data.choices[0].message.content.trim());
};

const openrouter = (sys,usr,model,tok) => {
  if(!OPENROUTER_API_KEY) return Promise.reject(new Error('No OPENROUTER_API_KEY'));
  return axios.post('https://openrouter.ai/api/v1/chat/completions',
    {model, messages:[{role:'system',content:sys},{role:'user',content:usr}], temperature:0.3, max_tokens:tok},
    {headers:{Authorization:`Bearer ${OPENROUTER_API_KEY}`,
      'HTTP-Referer':'https://wisdom-ujin.onrender.com','X-Title':'Wisdom Ujin'}, timeout:12000}
  ).then(r=>r.data.choices[0].message.content.trim());
};

// ── 11-Tier Cascade — Groq FIRST (เสถียรที่สุด) ──────────────────────────────
async function aiComplete(userPrompt, systemPrompt, maxTokens=800) {
  const sys = systemPrompt || 'คุณคือวิสดอม ผู้ช่วย AI ของ Wisdom International';
  function detectLoop(text) {
  if (!text || text.length < 60) return false;
  const esc = text.slice(0, 20).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  try { if ((text.match(new RegExp(esc, "g")) || []).length >= 4) return true; } catch (e) {}
  const seen = new Set(); let dupes = 0;
  for (let i = 0; i + 20 <= text.length; i += 10) {
    const c = text.slice(i, i + 20);
    if (seen.has(c)) { if (++dupes >= 5) return true; } else seen.add(c);
  }
  return false;
}
const tiers = [
    {n:'T01:Groq-70b',      f:()=>groq(sys,userPrompt,'llama-3.3-70b-versatile',maxTokens)},
    {n:'T02:Gemini-2.0',    f:()=>gemini(sys,userPrompt,'gemini-2.0-flash',maxTokens)},
    {n:'T03:Groq-70b-v2',   f:()=>groq(sys,userPrompt,'llama-3.1-70b-versatile',maxTokens)},
    {n:'T04:Groq-DeepSeek', f:()=>groq(sys,userPrompt,'deepseek-r1-distill-llama-70b',maxTokens)},
    {n:'T05:Groq-Qwen',     f:()=>groq(sys,userPrompt,'qwen-qwq-32b',maxTokens)},
    {n:'T06:Groq-Kimi',     f:()=>groq(sys,userPrompt,'moonshotai/kimi-k2-instruct',maxTokens)},
    {n:'T07:Cerebras-70b',  f:()=>cerebras(sys,userPrompt,maxTokens)},
    {n:'T08:Gemini-1.5',    f:()=>gemini(sys,userPrompt,'gemini-1.5-flash-latest',maxTokens)},
    {n:'T09:OR-llama-70b',  f:()=>openrouter(sys,userPrompt,'meta-llama/llama-3.3-70b-instruct:free',maxTokens)},
    {n:'T10:OR-Gemma2',     f:()=>openrouter(sys,userPrompt,'google/gemma-2-9b-it:free',maxTokens)},
    {n:'T11:Groq-8b',       f:()=>groq(sys,userPrompt,'llama-3.1-8b-instant',maxTokens)},
  ];
  for (const t of tiers) {
    try {
      const out = await t.f();
      if (out && out.trim().length > 10 && !detectLoop(out)) { console.log('[SUM] ok ' + t.n); return out; }
    } catch(e) {
      console.log('[SUM] err ' + t.n + ': ' + (e.response?.status || e.message?.slice(0,50)));
    }
  }
  return 'ขออภัย ระบบ AI กำลังมีภาระสูง กรุณาลองใหม่ครับ';
}

// ── Public API ────────────────────────────────────────────────────────────────
async function summarizeMessages(messages, mode='default') {
  if (!messages || messages.length === 0) return null;
  const p = buildPrompt(mode, messages);
  return await aiComplete(p.user, p.sys, p.tok);
}

async function generateSummary(messages) {
  return summarizeMessages(messages, 'pipeline');
}

/**
 * summarizeForLark — called by server.js (สรุป keyword) and cronJob.js
 * @param {Array} messages
 * @param {string} groupIdOrMode — mode string หรือ groupId (default: 'pipeline')
 */
async function summarizeForLark(messages, groupIdOrMode) {
  const mode = ['evening','morning','pipeline','default'].includes(groupIdOrMode)
    ? groupIdOrMode : 'pipeline';
  return summarizeMessages(messages, mode);
}

module.exports = { summarizeMessages, summarizeForLark, generateSummary, aiComplete };
