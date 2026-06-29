/**
 * aiSummarizer.js — สมองอูจิน (우진) Smart Analysis Engine
 *
 * 8-tier AI cascade (all FREE, independent quota pools):
 *  T1: Groq llama-3.3-70b     —  6K TPM  best quality
 *  T2: Gemini 1.5 Flash       —  1M TPM  excellent
 *  T3: Gemini 2.0 Flash       —  4M TPM  very fast
 *  T4: Cerebras llama-3.3-70b — 60K TPM  blazing fast
 *  T5: OpenRouter 70b:free    — free     separate pool
 *  T6: Groq Mixtral-8x7b      —  5K TPM
 *  T7: Groq Gemma2-9b         — 14K TPM
 *  T8: Groq llama-3.1-8b      —  6K TPM  last resort
 *
 * Context-aware smart prompts:
 *  'evening'  → deep day analysis + tomorrow to-do
 *  'morning'  → overnight backlog + team briefing
 *  'pipeline' → quick hourly task extraction
 *  default    → general intelligent summary
 */
require('dotenv').config();
const OpenAI = require('openai');
const axios  = require('axios');

// ── API Keys ───────────────────────────────────────────────────────────────────
const GROQ_API_KEY       = process.env.GROQ_API_KEY;
const GEMINI_API_KEY     = process.env.GEMINI_API_KEY;
const CEREBRAS_API_KEY   = process.env.CEREBRAS_API_KEY;   // cerebras.ai (free)
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY; // openrouter.ai (free)

// ── OpenAI (legacy hourly pipeline — keep intact) ────────────────────────────
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL  = process.env.OPENAI_MODEL ?? 'gpt-4o';

const SYSTEM_PROMPT = `
You are a professional work-task extractor for a Thai business team.
Analyze the LINE chat messages provided by the user.
Filter out: greetings, stickers, emoji-only messages, small talk, and anything non-actionable.

If there are NO actionable tasks, respond with exactly:
{"tasks": []}

If there ARE actionable tasks, respond with ONLY valid JSON — no markdown fences, no prose:
{
  "tasks": [
    {
      "summary": "<Short task title, max 50 characters>",
      "description": "<Task details: Who, What, Where, When>",
      "priority": "<High | Medium | Low>",
      "client_name": "<Extracted client or stakeholder name, or 'Internal' if none>"
    }
  ]
}
`.trim();

function buildUserContent(messages) {
  return messages
    .map(m => `[${m.timestamp}] ${m.senderName}: ${m.text}`)
    .join('\n');
}

async function summarizeMessages(messages) {
  if (messages.length === 0) { console.log('[AI] No messages to summarize.'); return []; }
  const userContent = buildUserContent(messages);
  console.log(`[AI] Sending ${messages.length} messages to ${MODEL}...`);
  try {
    const completion = await client.chat.completions.create({
      model: MODEL, temperature: 0.2,
      response_format: { type: 'json_object' },
      messages: [{ role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content: userContent }],
    });
    const tasks = JSON.parse(completion.choices[0].message.content).tasks ?? [];
    console.log(`[AI] Identified ${tasks.length} task(s).`);
    return tasks;
  } catch (err) {
    console.error('[AI] Summarization failed:', err.message);
    return [];
  }
}

// ── Smart Context-Aware Prompts ───────────────────────────────────────────────
const PROMPTS = {

  evening: `คุณคือ อูจิน (우진) สมองวิเคราะห์ธุรกิจของ Wisdom International
ที่ฉลาด แม่นยำ และมองเห็นรูปแบบที่ซ่อนอยู่ในบทสนทนา

วิเคราะห์บทสนทนาทั้งวันนี้อย่างละเอียด แล้วจัดทำรายงานสิ้นวันที่มีคุณค่าสูง:

🌆 *สรุปภาพรวมวันนี้*
[อธิบายภาพรวม 2-3 ประโยค บอกว่าวันนี้เป็นอย่างไร ยุ่งไหม มีประเด็นอะไรใหญ่]

📊 *ประเด็นหลักที่พูดถึงวันนี้*
[Top 3-5 เรื่องสำคัญที่สุด พร้อมบริบทสั้นๆ]

🔴 *งานค้าง / ต้องจัดการพรุ่งนี้*
[รายการเรียงตามความเร่งด่วน พร้อมผู้รับผิดชอบถ้ามี]

✅ *สิ่งที่จัดการสำเร็จวันนี้*
[งานที่เสร็จสมบูรณ์แล้ว]

⚠️ *ปัญหา / ความเสี่ยงที่ต้องระวัง*
[ปัญหาซ้ำ คำร้องเรียน หรือสัญญาณที่น่ากังวล]

💡 *ข้อสังเกตและข้อเสนอแนะจากอูจิน*
[วิเคราะห์แบบชาญฉลาด: มีรูปแบบน่าสนใจ? สิ่งที่ควรปรับปรุง? โอกาสที่ยังพลาด?]

📋 *To-do พรุ่งนี้ (เรียงลำดับ)*
1. [เร่งด่วนที่สุด]
2. 
3. 

ตอบเป็นภาษาไทย กระชับ ตรงประเด็น ใช้ข้อมูลจากบทสนทนาจริงๆ`,

  morning: `คุณคือ อูจิน (우진) ผู้ช่วยเตรียมความพร้อมประจำเช้าของ Wisdom International

สรุปข้อความนอกเวลางานที่ค้างอยู่ และเตรียมทีมสำหรับวันทำงานใหม่:

🌅 *เช้านี้ต้องจัดการก่อน (เรียงลำดับความสำคัญ)*
[งานเร่งด่วนจากข้อความค้าง]

📩 *ข้อความสำคัญจากลูกค้า*
[ใครส่งอะไรมา ต้องตอบอะไรก่อน]

💬 *สรุปสั้นสำหรับทีม*
[2-3 ประโยค ให้ทีมรู้ว่าต้องเตรียมตัวอย่างไร]

ตอบเป็นภาษาไทย กระชับ ตรงประเด็น`,

  pipeline: `คุณคือผู้ช่วยสรุปงานของ Wisdom International

วิเคราะห์ข้อความต่อไปนี้แล้วระบุ:

📋 *งานที่ต้องดำเนินการ*
[รายการที่ชัดเจน พร้อมผู้รับผิดชอบถ้ามี]

⚠️ *ประเด็นเร่งด่วนหรือสำคัญ*
[ข้อมูลที่ต้องรู้ทันที]

กระชับ ไม่เกิน 5 รายการต่อหมวด ตอบภาษาไทย`,

  default: `คุณคือ อูจิน (우진) ผู้ช่วยวิเคราะห์และสรุปงานอัจฉริยะของ Wisdom International

สรุปบทสนทนาต่อไปนี้อย่างชาญฉลาด:

📋 *ภาพรวม*
[สรุป 2-3 ประโยค]

✅ *งานที่ต้องทำ*
[รายการพร้อมผู้รับผิดชอบ]

⚠️ *ประเด็นสำคัญ*
[ข้อมูลสำคัญหรือปัญหาที่พบ]

👥 *ผู้เกี่ยวข้อง*
[ชื่อและบทบาทที่กล่าวถึง]

ตอบเป็นภาษาไทย กระชับ ตรงประเด็น`,
};

// ── Tier Callers ───────────────────────────────────────────────────────────────
function isQuotaErr(err) {
  const s = err.response?.status;
  return s === 429 || s === 413 || s === 503;
}

const callGroq = (sys, usr, model, maxTok) =>
  axios.post('https://api.groq.com/openai/v1/chat/completions',
    { model, messages: [{ role:'system', content:sys }, { role:'user', content:usr }],
      temperature: 0.3, max_tokens: maxTok },
    { headers: { Authorization: `Bearer ${GROQ_API_KEY}` }, timeout: 25000 }
  ).then(r => r.data.choices[0].message.content.trim());

const callGemini = (sys, usr, model, maxTok) =>
  axios.post(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`,
    { contents: [{ parts: [{ text: sys + '\n\n' + usr }] }],
      generationConfig: { temperature: 0.3, maxOutputTokens: maxTok } },
    { timeout: 25000 }
  ).then(r => r.data.candidates[0].content.parts[0].text.trim());

const callCerebras = (sys, usr, maxTok) => {
  if (!CEREBRAS_API_KEY) return Promise.reject(new Error('No CEREBRAS_API_KEY'));
  return axios.post('https://api.cerebras.ai/v1/chat/completions',
    { model: 'llama-3.3-70b', messages: [{ role:'system', content:sys }, { role:'user', content:usr }],
      temperature: 0.3, max_tokens: maxTok },
    { headers: { Authorization: `Bearer ${CEREBRAS_API_KEY}` }, timeout: 25000 }
  ).then(r => r.data.choices[0].message.content.trim());
};

const callOpenRouter = (sys, usr, maxTok) => {
  if (!OPENROUTER_API_KEY) return Promise.reject(new Error('No OPENROUTER_API_KEY'));
  return axios.post('https://openrouter.ai/api/v1/chat/completions',
    { model: 'meta-llama/llama-3.3-70b-instruct:free',
      messages: [{ role:'system', content:sys }, { role:'user', content:usr }],
      temperature: 0.3, max_tokens: maxTok },
    { headers: { Authorization: `Bearer ${OPENROUTER_API_KEY}`,
        'HTTP-Referer': 'https://wisdom-ujin.onrender.com', 'X-Title': 'Wisdom อูจิน AI' },
      timeout: 25000 }
  ).then(r => r.data.choices[0].message.content.trim());
};

// ── 8-Tier AI Cascade ─────────────────────────────────────────────────────────
async function aiComplete(systemPrompt, userPrompt, maxTokens = 2000) {
  const tiers = [
    { name: 'T1:Groq-70b',      fn: () => callGroq(systemPrompt, userPrompt, 'llama-3.3-70b-versatile', maxTokens) },
    { name: 'T2:Gemini-1.5',    fn: () => (GEMINI_API_KEY ? callGemini(systemPrompt, userPrompt, 'gemini-1.5-flash', maxTokens) : Promise.reject(new Error('No GEMINI_API_KEY'))) },
    { name: 'T3:Gemini-2.0',    fn: () => (GEMINI_API_KEY ? callGemini(systemPrompt, userPrompt, 'gemini-2.0-flash', maxTokens) : Promise.reject(new Error('No GEMINI_API_KEY'))) },
    { name: 'T4:Cerebras-70b',  fn: () => callCerebras(systemPrompt, userPrompt, maxTokens) },
    { name: 'T5:OpenRouter-70b',fn: () => callOpenRouter(systemPrompt, userPrompt, maxTokens) },
    { name: 'T6:Groq-Mixtral',  fn: () => callGroq(systemPrompt, userPrompt, 'mixtral-8x7b-32768', maxTokens) },
    { name: 'T7:Groq-Gemma2',   fn: () => callGroq(systemPrompt, userPrompt, 'gemma2-9b-it', maxTokens) },
    { name: 'T8:Groq-8b',       fn: () => callGroq(systemPrompt, userPrompt, 'llama-3.1-8b-instant', maxTokens) },
  ];

  for (const tier of tiers) {
    try {
      const out = await tier.fn();
      if (out && out.trim().length > 10) {
        console.log(`[AI] ✓ ${tier.name}`);
        return out;
      }
      console.log(`[AI] ${tier.name} empty → next`);
    } catch (err) {
      const reason = isQuotaErr(err) ? `quota(${err.response?.status})`
                   : err.message?.startsWith('No ') ? 'no key'
                   : err.message?.slice(0, 40);
      console.log(`[AI] ${tier.name} ${reason} → next`);
    }
  }
  throw new Error('All 8 AI tiers failed');
}

// ── Smart Summary ─────────────────────────────────────────────────────────────
function formatConversation(messages) {
  return messages
    .map(m => `[${new Date(m.timestamp).toLocaleTimeString('th-TH')}] ${m.senderName}: ${m.text}`)
    .join('\n');
}

/**
 * summarizeForLark — context-aware intelligent summary
 * @param {Array<{timestamp, senderName, text}>} messages
 * @param {string} type - 'evening' | 'morning' | 'pipeline' | groupId (→ default)
 * @returns {Promise<string>}
 */
async function summarizeForLark(messages, type = 'default') {
  if (!messages || messages.length === 0) return '(ไม่มีข้อความในช่วงนี้)';

  const ctx      = ['evening', 'morning', 'pipeline'].includes(type) ? type : 'default';
  const prompt   = PROMPTS[ctx];
  const maxTok   = ctx === 'evening' ? 2000 : ctx === 'morning' ? 1200 : 800;
  const label    = ctx !== type ? ` — กลุ่ม: ${type}` : '';
  const userMsg  = `บทสนทนา (${messages.length} ข้อความ)${label}:\n\n${formatConversation(messages)}`;

  console.log(`[AI] summarizeForLark type="${ctx}" msgs=${messages.length} maxTok=${maxTok}`);

  try {
    return await aiComplete(prompt, userMsg, maxTok);
  } catch (err) {
    console.error('[AI] All tiers failed:', err.message);
    return '❌ ขออภัย ไม่สามารถสรุปงานได้ในขณะนี้ กรุณาลองใหม่อีกครั้ง';
  }
}

module.exports = { summarizeMessages, summarizeForLark };
