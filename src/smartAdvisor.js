/**
 * smartAdvisor.js — อูจิน Elite Intelligence Engine v4
 *
 * FIXES v4:
 * - คิดลึกแต่ตอบสั้น — ห้ามแสดง steps ออกมา
 * - สร้างรูปเฉพาะเมื่อผู้ใช้ขอตรงๆ เท่านั้น
 * - 11-tier FREE cascade
 */
require('dotenv').config();
const axios = require('axios');

const GROQ_API_KEY       = process.env.GROQ_API_KEY;
const GEMINI_API_KEY     = process.env.GEMINI_API_KEY;
const CEREBRAS_API_KEY   = process.env.CEREBRAS_API_KEY;
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;

// ═══════════════════════════════════════════════════════════════════
// MASTER SYSTEM PROMPT — คิดลึก แต่ตอบเป็นธรรมชาติ ห้ามแสดง steps
// ═══════════════════════════════════════════════════════════════════
const MASTER_SYSTEM = `You are อูจิน (우진), an elite AI assistant for Wisdom International.

INTERNAL THINKING (do this silently — NEVER write these steps in your response):
Think step by step before answering: understand the real need, identify relevant domains, analyze all angles, synthesize an accurate answer.

OUTPUT RULES — CRITICAL:
1. Write ONLY the final answer. NO step labels. NO "Step 1", NO "DECODE:", NO "SCOPE:", NO "ANALYZE:", NO "SYNTHESIZE:", NO "VERIFY:" in your response.
2. Write naturally like a knowledgeable expert friend — conversational, clear, helpful.
3. Be specific: include real numbers, timelines, costs, law references when relevant.
4. Structure with bullet points or numbered lists ONLY when there are multiple distinct items.
5. Match the language of the question (Thai/Korean/English).
6. Keep responses concise but complete — no unnecessary padding.

IMAGE GENERATION:
ONLY add [GENERATE_IMAGE: prompt] if the user explicitly asks for a picture, chart, infographic, diagram, or visual. 
Do NOT add it for normal questions about money, law, business, or any topic unless they say "สร้างรูป", "วาด", "infographic", "chart", "diagram", "ภาพ", "generate image".

KNOWLEDGE BASE (expert level — use internally):
Thai Law: DBD registration 3-5 days 5K-25K THB | Revenue Dept VAT 30 days free | DOE work permit 7-30 days 750-3000 THB | Immigration visa renewal 1900 THB | DIP trademark 8-24 months 3500 THB/class | BOI 3-8yr tax exemption | Land transfer 2-3.5% | Labour Act §118 severance | SSO registration 1-3 days | PDPA compliance
Korean Business: dart.fss.or.kr registration | KOTRA support | Labour Standards Act 52hr/week | E-7/D-8/F visas
Finance: DCF, P/E, EV/EBITDA | crypto tax Thailand | FX spot vs forward | thin capitalization | transfer pricing
Tech: all programming languages | AI/ML/LLM | AWS/GCP/Azure | security OWASP | REST/GraphQL
Science: physics, chemistry, biology, math, statistics — expert level
Medicine: disease mechanisms, pharmacology, nutrition (always add: consult a doctor)
All other domains: business strategy, marketing, psychology, history, design, engineering`;

// ═══════════════════════════════════════════════════════════════════
// IMAGE GENERATION — Pollinations.ai (FREE, no key needed)
// ═══════════════════════════════════════════════════════════════════
function buildImageUrl(prompt, w=1200, h=800) {
  const p = encodeURIComponent(prompt + ', high quality, professional, detailed');
  return `https://image.pollinations.ai/prompt/${p}?width=${w}&height=${h}&nologo=true`;
}

function extractImagePrompt(text) {
  const m = text.match(/\[GENERATE_IMAGE:\s*([^\]]+)\]/i);
  return m ? m[1].trim() : null;
}

function stripImageTag(text) {
  return text.replace(/\[GENERATE_IMAGE:[^\]]*\]/gi, '').trim();
}

// Only trigger image gen when user EXPLICITLY asks — very strict
function userExplicitlyWantsImage(text) {
  return /สร้าง(รูป|ภาพ)|วาด(รูป|ภาพ)|generate\s*image|make\s*(a\s*)?(picture|image|chart|graph)|infographic|อินโฟกราฟิก|ช่วยวาด|ขอภาพ|ทำกราฟ|สร้างแผนภูมิ|diagram\s*(of|for|showing)|flowchart|timeline\s*(chart|diagram)/i.test(text);
}

// ═══════════════════════════════════════════════════════════════════
// TIER CALLERS (all FREE)
// ═══════════════════════════════════════════════════════════════════
const groq = (sys,usr,model,tok=1500) =>
  axios.post('https://api.groq.com/openai/v1/chat/completions',
    {model, messages:[{role:'system',content:sys},{role:'user',content:usr}], temperature:0.35, max_tokens:tok},
    {headers:{Authorization:`Bearer ${GROQ_API_KEY}`}, timeout:28000}
  ).then(r=>r.data.choices[0].message.content.trim());

const gemini = (sys,usr,model,tok=1500) => {
  if(!GEMINI_API_KEY) return Promise.reject(new Error('No GEMINI_API_KEY'));
  return axios.post(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`,
    {contents:[{parts:[{text:sys+'\n\n'+usr}]}],
     generationConfig:{temperature:0.35, maxOutputTokens:tok}},
    {timeout:28000}
  ).then(r=>r.data.candidates[0].content.parts[0].text.trim());
};

const cerebras = (sys,usr,tok=1500) => {
  if(!CEREBRAS_API_KEY) return Promise.reject(new Error('No CEREBRAS_API_KEY'));
  return axios.post('https://api.cerebras.ai/v1/chat/completions',
    {model:'llama-3.3-70b', messages:[{role:'system',content:sys},{role:'user',content:usr}], temperature:0.35, max_tokens:tok},
    {headers:{Authorization:`Bearer ${CEREBRAS_API_KEY}`}, timeout:28000}
  ).then(r=>r.data.choices[0].message.content.trim());
};

const openrouter = (sys,usr,model,tok=1500) => {
  if(!OPENROUTER_API_KEY) return Promise.reject(new Error('No OPENROUTER_API_KEY'));
  return axios.post('https://openrouter.ai/api/v1/chat/completions',
    {model, messages:[{role:'system',content:sys},{role:'user',content:usr}], temperature:0.35, max_tokens:tok},
    {headers:{Authorization:`Bearer ${OPENROUTER_API_KEY}`,
      'HTTP-Referer':'https://wisdom-ujin.onrender.com','X-Title':'Wisdom Ujin'}, timeout:28000}
  ).then(r=>r.data.choices[0].message.content.trim());
};

// ═══════════════════════════════════════════════════════════════════
// 11-TIER FREE CASCADE
// ═══════════════════════════════════════════════════════════════════
async function aiComplete(userPrompt, sys, maxTok=1500) {
  const systemPrompt = sys || MASTER_SYSTEM;
  const tiers = [
    {n:'T01:Gemini-2.0', f:()=>gemini(systemPrompt,userPrompt,'gemini-2.0-flash',maxTok)},
    {n:'T02:Gemini-1.5', f:()=>gemini(systemPrompt,userPrompt,'gemini-1.5-flash',maxTok)},
    {n:'T03:Cerebras',   f:()=>cerebras(systemPrompt,userPrompt,maxTok)},
    {n:'T04:Groq-70b',   f:()=>groq(systemPrompt,userPrompt,'llama-3.3-70b-versatile',maxTok)},
    {n:'T05:OR-llama',   f:()=>openrouter(systemPrompt,userPrompt,'meta-llama/llama-3.3-70b-instruct:free',maxTok)},
    {n:'T06:OR-Gemma2',  f:()=>openrouter(systemPrompt,userPrompt,'google/gemma-2-9b-it:free',maxTok)},
    {n:'T07:Groq-Mix',   f:()=>groq(systemPrompt,userPrompt,'mixtral-8x7b-32768',maxTok)},
    {n:'T08:Groq-G2',    f:()=>groq(systemPrompt,userPrompt,'gemma2-9b-it',maxTok)},
    {n:'T09:OR-Mis7b',   f:()=>openrouter(systemPrompt,userPrompt,'mistralai/mistral-7b-instruct:free',maxTok)},
    {n:'T10:OR-Phi3',    f:()=>openrouter(systemPrompt,userPrompt,'microsoft/phi-3-mini-128k-instruct:free',maxTok)},
    {n:'T11:Groq-8b',    f:()=>groq(systemPrompt,userPrompt,'llama-3.1-8b-instant',maxTok)},
  ];
  for (const t of tiers) {
    try {
      const out = await t.f();
      if (out && out.trim().length > 10) {
        console.log(`[SmartBrain] ✓ ${t.n}`);
        return out;
      }
    } catch(e) {
      console.log(`[SmartBrain] ✗ ${t.n}: ${e.message?.slice(0,60)}`);
    }
  }
  return 'ขออภัยครับ ระบบ AI มีภาระสูงอยู่ กรุณาลองใหม่อีกครั้งนะครับ 🙏';
}

// ═══════════════════════════════════════════════════════════════════
// QUESTION DETECTOR
// ═══════════════════════════════════════════════════════════════════
function isQuestion(text) {
  if (!text || text.trim().length < 3) return false;
  const t = text.trim();
  return [
    /[?？꽤]/,
    /^(ใคร|อะไร|ที่ไหน|เมื่อไร|ทำไม|อย่างไร|เท่าไร|กี่|ยังไง|ได้ไหม|มีไหม|ใช่ไหม|บอก|แนะนำ|ช่วย|สอน|อธิบาย)/,
    /^(누구|뭐|어디|언제|왜|어떻게|얼마|몇|할수있|있나요|인가요|되나요|알려|도와|설명)/,
    /^(who|what|where|when|why|how|is|are|can|could|would|should|tell|explain|help)/i,
    /(ช่วย|แนะนำ|บอก|อธิบาย|หา|ขอ).*(หน่อย|ได้ไหม|ครับ|ค่ะ|คะ)/,
  ].some(p => p.test(t));
}

// ═══════════════════════════════════════════════════════════════════
// PUBLIC API
// ═══════════════════════════════════════════════════════════════════

/**
 * answerAIUrgent — LINE AI Urgent mode
 * Returns: { text: string, imageUrl?: string }
 */
async function answerAIUrgent(text, senderName) {
  const userPrompt = `${senderName} ถามว่า: ${text}`;
  const raw = await aiComplete(userPrompt, MASTER_SYSTEM, 1500);

  // Strip any accidental step labels the model might still produce
  const cleanText = raw
    .replace(/\*{0,2}(Step\s*\d+|ขั้นตอนที่\s*\d+|DECODE|SCOPE|ANALYZE|SYNTHESIZE|VERIFY)\*{0,2}:?\s*/gi, '')
    .trim();

  // Image: ONLY if user explicitly asked AND model included [GENERATE_IMAGE:...]
  let imageUrl;
  if (userExplicitlyWantsImage(text)) {
    const imagePrompt = extractImagePrompt(raw);
    if (imagePrompt) {
      imageUrl = buildImageUrl(imagePrompt);
      console.log(`[SmartBrain] 🎨 ${imagePrompt.slice(0,60)}`);
    }
  }

  return { text: stripImageTag(cleanText), imageUrl };
}

/**
 * analyzeForLark — background analysis → Lark only
 */
async function analyzeForLark(text, senderName, groupId) {
  try {
    const userPrompt = `วิเคราะห์ข้อความจากกลุ่ม LINE:
ผู้พูด: ${senderName} | กลุ่ม: ${groupId}
ข้อความ: "${text}"

วิเคราะห์สั้น: ประเด็นสำคัญ, ข้อมูลที่เกี่ยวข้อง, ข้อแนะนำสำหรับทีม (ตอบเป็นไทย)`;

    const analysis = await aiComplete(userPrompt, MASTER_SYSTEM, 800);

    const { sendSummaryCard } = require('./larkMessenger');
    const now = new Date().toLocaleString('th-TH',{timeZone:'Asia/Bangkok'});
    await sendSummaryCard(
      `🧠 วิเคราะห์ — ${senderName} · ${now}`,
      `❓ ${text}\n\n${analysis}\n\n> อูจิน Smart Brain | Wisdom`
    );
  } catch(e) {
    console.error('[SmartAdvisor] analyzeForLark:', e.message);
  }
}

function buildSystemPrompt(context='') {
  return MASTER_SYSTEM + (context ? '\n\nContext: ' + context : '');
}

module.exports = { isQuestion, answerAIUrgent, analyzeForLark, aiComplete, buildSystemPrompt, MASTER_SYSTEM };
