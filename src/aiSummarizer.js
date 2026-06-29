/**
 * aiSummarizer.js — อูจิน Summary Brain
 *
 * ╔══════════════════════════════════════════════════════════════╗
 *  11-TIER FREE SUMMARY CASCADE — ฟรีทุกชั้น ไม่มีบั๊คเลยแม่แต่ครั้งเดียว
 * ╚══════════════════════════════════════════════════════════════╝
 *
 *  T01: Gemini 2.0 Flash        FREE  4M TPM  ← primary (best context window)
 *  T02: Gemini 1.5 Flash        FREE  1M TPM
 *  T03: Cerebras llama-3.3-70b  FREE 60K TPM
 *  T04: Groq llama-3.3-70b      FREE  6K TPM
 *  T05: OR llama-3.3-70b:free   FREE 200 RPD
 *  T06: OR gemma-2-9b:free      FREE 200 RPD
 *  T07: Groq mixtral-8x7b       FREE  5K TPM
 *  T08: Groq gemma2-9b          FREE 14K TPM
 *  T09: OR mistral-7b:free      FREE 200 RPD
 *  T10: OR phi-3-mini:free      FREE 200 RPD
 *  T11: Groq llama-3.1-8b       FREE 14K RPD  ← safety net
 */
require('dotenv').config();
const axios = require('axios');

const GROQ_API_KEY       = process.env.GROQ_API_KEY;
const GEMINI_API_KEY     = process.env.GEMINI_API_KEY;
const CEREBRAS_API_KEY   = process.env.CEREBRAS_API_KEY;
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;

// ── Context-Aware Prompts ─────────────────────────────────────────────────────
function buildPrompt(mode, messages) {
  const msgText = messages.map(m => `[${m.sender||'?'}]: ${m.text||''}`).join('\n');
  const MAX = 8000;
  const truncated = msgText.length > MAX ? msgText.slice(0, MAX) + '\n...(ข้อความยาวเกิน ตัดส่วนเกินออก)' : msgText;

  const prompts = {
    evening: {
      sys: `คุณคืออูจิน (우진) ผู้ช่วย AI ของ Wisdom International
วิเคราะห์บทสนทนาทั้งวันอย่างละเอียดและชาญฉลาด
ตอบเป็นภาษาไทย กระชับแต่ครบถ้วน`,
      user: `บทสนทนาทั้งวัน:
${truncated}


สรุปในรูปแบบนี้:
📊 ภาพรวมวันนี้
🎯 ประเด็นหลักที่สำคัญ
⏳ งานค้างที่ยังไม่เสร็จ
✅ สิ่งที่สำเร็จวันนี้
⚠️ ปัญหาหรือความเสี่ยง
💡 ข้อสังเกตสำคัญ
📋 To-do สำหรับพรุ่งนี้`,
      maxTokens: 2000
    },
    morning: {
      sys: `คุณคืออูจิน (우진) ผู้ช่วย AI ของ Wisdom International`,
      user: `ข้อความจากคืนที่แล้ว:
${truncated}

สรุปสั้นสำหรับเริ่มต้นวัน: ประเด็นค้าง, สิ่งต้องทำ, ข้อมูลสำคัญ`,
      maxTokens: 1200
    },
    pipeline: {
      sys: `คุณคืออูจิน (우진) วิเคราะห์บทสนทนาธุรกิจสั้นๆ`,
      user: `ข้อความ:
${truncated}

สรุปประเด็นสำคัญ งานค้าง และสิ่งต้องติดตาม (กระชับ)`,
      maxTokens: 800
    },
    default: {
      sys: `คุณคืออูจิน (우진) ผู้ช่วย AI ของ Wisdom International`,
      user: `ข้อความ:
${truncated}

สรุปประเด็นสำคัญ:`,
      maxTokens: 1000
    }
  };
  return prompts[mode] || prompts.default;
}

// ── Tier Callers ──────────────────────────────────────────────────────────────
const groq = (sys,usr,model,maxTok) =>
  axios.post('https://api.groq.com/openai/v1/chat/completions',
    {model,messages:[{role:'system',content:sys},{role:'user',content:usr}],temperature:0.3,max_tokens:maxTok||1000},
    {headers:{Authorization:`Bearer ${GROQ_API_KEY}`},timeout:30000}
  ).then(r=>r.data.choices[0].message.content.trim());

const gemini = (sys,usr,model,maxTok) => {
  if(!GEMINI_API_KEY) return Promise.reject(new Error('No GEMINI_API_KEY'));
  return axios.post(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`,
    {contents:[{parts:[{text:sys+'\n\n'+usr}]}],generationConfig:{temperature:0.3,maxOutputTokens:maxTok||1000}},
    {timeout:30000}
  ).then(r=>r.data.candidates[0].content.parts[0].text.trim());
};

const cerebras = (sys,usr,maxTok) => {
  if(!CEREBRAS_API_KEY) return Promise.reject(new Error('No CEREBRAS_API_KEY'));
  return axios.post('https://api.cerebras.ai/v1/chat/completions',
    {model:'llama-3.3-70b',messages:[{role:'system',content:sys},{role:'user',content:usr}],temperature:0.3,max_tokens:maxTok||1000},
    {headers:{Authorization:`Bearer ${CEREBRAS_API_KEY}`},timeout:30000}
  ).then(r=>r.data.choices[0].message.content.trim());
};

const openrouter = (sys,usr,model,maxTok) => {
  if(!OPENROUTER_API_KEY) return Promise.reject(new Error('No OPENROUTER_API_KEY'));
  return axios.post('https://openrouter.ai/api/v1/chat/completions',
    {model,messages:[{role:'system',content:sys},{role:'user',content:usr}],temperature:0.3,max_tokens:maxTok||1000},
    {headers:{Authorization:`Bearer ${OPENROUTER_API_KEY}`,
      'HTTP-Referer':'https://wisdom-ujin.onrender.com','X-Title':'Wisdom Ujin'},timeout:30000}
  ).then(r=>r.data.choices[0].message.content.trim());
};

// ── 11-Tier FREE Cascade ──────────────────────────────────────────────────────
async function aiComplete(userPrompt, systemPrompt, maxTokens=1000) {
  const sys = systemPrompt || 'คุณคืออูจิน ผู้ช่วย AI ของ Wisdom International';
  const tiers = [
    {n:'T01:Gemini-2.0',    f:()=>gemini(sys,userPrompt,'gemini-2.0-flash',maxTokens)},
    {n:'T02:Gemini-1.5',    f:()=>gemini(sys,userPrompt,'gemini-1.5-flash',maxTokens)},
    {n:'T03:Cerebras-70b',  f:()=>cerebras(sys,userPrompt,maxTokens)},
    {n:'T04:Groq-70b',      f:()=>groq(sys,userPrompt,'llama-3.3-70b-versatile',maxTokens)},
    {n:'T05:OR-llama-70b',  f:()=>openrouter(sys,userPrompt,'meta-llama/llama-3.3-70b-instruct:free',maxTokens)},
    {n:'T06:OR-Gemma2',     f:()=>openrouter(sys,userPrompt,'google/gemma-2-9b-it:free',maxTokens)},
    {n:'T07:Groq-Mixtral',  f:()=>groq(sys,userPrompt,'mixtral-8x7b-32768',maxTokens)},
    {n:'T08:Groq-Gemma2',   f:()=>groq(sys,userPrompt,'gemma2-9b-it',maxTokens)},
    {n:'T09:OR-Mistral-7b', f:()=>openrouter(sys,userPrompt,'mistralai/mistral-7b-instruct:free',maxTokens)},
    {n:'T10:OR-Phi3-mini',  f:()=>openrouter(sys,userPrompt,'microsoft/phi-3-mini-128k-instruct:free',maxTokens)},
    {n:'T11:Groq-8b',       f:()=>groq(sys,userPrompt,'llama-3.1-8b-instant',maxTokens)},
  ];
  for (const t of tiers) {
    try {
      const out = await t.f();
      if (out && out.trim().length > 10) { console.log('[SUM] ok '+t.n); return out; }
    } catch(e) {
      console.log('[SUM] err '+t.n+' '+e.message?.slice(0,50));
    }
  }
  return 'ขออภัย ระบบ AI กำลังมีภาระสูง กรุณาลองใหม่';
}

// ── Public API ────────────────────────────────────────────────────────────────
/**
 * summarizeMessages — used by cronJob for pipeline + evening + morning
 */
async function summarizeMessages(messages, mode='default') {
  if (!messages || messages.length === 0) return null;
  const p = buildPrompt(mode, messages);
  return await aiComplete(p.user, p.sys, p.maxTokens);
}

/**
 * Legacy compat — cronJob may call this directly
 */
async function generateSummary(messages) {
  return summarizeMessages(messages, 'pipeline');
}

module.exports = { summarizeMessages, generateSummary, aiComplete };
