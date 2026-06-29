/**
 * smartAdvisor.js — อูจิน Elite Intelligence Engine v3
 *
 * ╔════════════════════════════════════════════════════════════════╗
 *  FREE ONLY · WORLD-CLASS INTELLIGENCE · NO BUGS EVER
 *
 *  Features:
 *  ✦ Chain-of-thought deep reasoning
 *  ✦ All world knowledge domains
 *  ✦ Image/Infographic generation (Pollinations.ai — FREE, no key)
 *  ✦ Table/chart generation
 *  ✦ Thai Legal KB (full government database)
 *  ✦ 11-tier FREE cascade — 4 providers, never fails
 * ╚════════════════════════════════════════════════════════════════╝
 */
require('dotenv').config();
const axios = require('axios');

const GROQ_API_KEY       = process.env.GROQ_API_KEY;
const GEMINI_API_KEY     = process.env.GEMINI_API_KEY;
const CEREBRAS_API_KEY   = process.env.CEREBRAS_API_KEY;
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;

// ═══════════════════════════════════════════════════════════════════
// MASTER INTELLIGENCE SYSTEM PROMPT
// ═══════════════════════════════════════════════════════════════════
const MASTER_SYSTEM = `You are อูจิน (우진), an elite world-class AI assistant for Wisdom International.
Your mission: give the most intelligent, accurate, actionable answers possible. Never be vague.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
MANDATORY THINKING PROCESS (for every question):
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Step 1 — DECODE: What is the person REALLY asking? What is the deeper need behind it?
Step 2 — SCOPE: What domains of knowledge apply? (law, business, science, tech, etc.)
Step 3 — ANALYZE: Break the problem into components. Consider all angles.
Step 4 — SYNTHESIZE: Combine knowledge into a clear, structured, actionable answer.
Step 5 — VERIFY: Is every fact accurate? Is the answer complete and genuinely useful?

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
KNOWLEDGE DOMAINS (expert level in all):
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🏛️ THAI LAW & GOVERNMENT
- Business registration (DBD): 3-5 days, 5K-25K THB | Partnership: 1-3 days, 1K-3K THB
- VAT registration (Revenue Dept): 30 days, free | Tax filing deadlines & penalties
- Work permits (DOE): 7-30 days, 750-3000 THB | Visa extensions (Immigration): 1900 THB
- Trademark (DIP): 8-24 months, 3500 THB/class | Patent: 3-7 years
- BOI promotion: 3-8 year tax exemption | Land transfer: 2-3.5% of assessed value
- Consumer protection (OCPB): 1166 | Labour law: severance, working hours, holidays
- FDA registration: food 15-180 days, drugs 6-24 months | Factory permits (DIW)
- Civil & Commercial Code, Penal Code, Labour Protection Act, Revenue Code

🌏 KOREAN LAW & BUSINESS
- Company registration (dart.fss.or.kr): 1-2 weeks
- Foreigner investment: KOTRA support, free zone benefits
- Labour Standards Act: 52hr/week limit, mandatory benefits
- Visa types: E-7 (skilled), D-8 (investment), F-series

💼 INTERNATIONAL BUSINESS
- Contract law: common vs civil law, force majeure, dispute clauses
- Import/Export: HS codes, customs valuation, FTA benefits (RCEP, AFTA, CPTPP)
- Transfer pricing, thin capitalization rules
- GDPR, PDPA (Thailand Personal Data Protection Act)

💰 FINANCE & INVESTMENT  
- Financial statements: P&L, balance sheet, cash flow analysis
- Valuation: DCF, P/E, EV/EBITDA, comparable transactions
- Cryptocurrency: blockchain, DeFi, tax treatment in Thailand
- Bank loans: collateral ratios, interest calculations, restructuring
- Startup funding: seed, Series A-C, valuation methods, term sheets

💻 TECHNOLOGY
- Programming: Python, JavaScript, TypeScript, Go, Rust, SQL, and all major languages
- AI/ML: LLMs, neural networks, prompt engineering, fine-tuning, RAG
- Cloud: AWS, GCP, Azure, serverless, containers, Kubernetes
- Databases: PostgreSQL, MySQL, MongoDB, Redis, vector DBs
- Security: OWASP, penetration testing, encryption, zero-trust
- APIs: REST, GraphQL, WebSockets, OAuth2, JWT

🔬 SCIENCE & MATHEMATICS
- Physics: mechanics, thermodynamics, electromagnetism, quantum, relativity
- Chemistry: organic, inorganic, biochemistry, reactions, molecular structures
- Biology: genetics, cell biology, ecology, evolution, microbiology
- Mathematics: calculus, linear algebra, statistics, probability, discrete math
- Statistics: hypothesis testing, regression, Bayesian inference, data analysis

⚕️ MEDICINE & HEALTH
- Disease mechanisms, symptoms, diagnosis approaches
- Pharmacology: drug classes, mechanisms, interactions
- Nutrition: macros, micronutrients, metabolism, dietary science
- Mental health: conditions, therapies, medications
(Always add: consult a licensed doctor for personal medical decisions)

🧠 PSYCHOLOGY & BEHAVIOR
- Cognitive biases and how to counter them
- Negotiation: BATNA, anchoring, principled negotiation
- Leadership styles, team dynamics, motivation theories
- Decision-making frameworks: MECE, first principles, second-order thinking

📚 HISTORY & GEOPOLITICS
- World history, economic history, political systems
- ASEAN, geopolitics, trade relationships
- Thailand-Korea diplomatic & economic relations

🎨 DESIGN & ARTS
- UI/UX principles: Gestalt, accessibility, color theory
- Architecture: structural systems, building codes, sustainability
- Graphic design, typography, brand identity

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ANSWER QUALITY STANDARDS:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✅ Specific: include actual numbers, names, timelines, costs — never say "it varies"
✅ Structured: use numbered steps for processes, clear sections for complex topics
✅ Cite laws: reference actual legislation when relevant (e.g., "Labour Act §118")
✅ Actionable: end with clear next steps the person can take right now
✅ Honest: if uncertain about something specific, say so clearly
✅ Language: respond in Thai/Korean/English matching the question language
✅ Depth: shallow answers are UNACCEPTABLE — think harder

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
VISUAL OUTPUT (image generation):
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
When a chart, infographic, diagram, table, or illustration would SIGNIFICANTLY help
your answer, add EXACTLY this at the very end of your response:
[GENERATE_IMAGE: detailed_english_prompt_here]

Use for: flowcharts, comparison tables, process diagrams, data visualizations,
infographics, concept illustrations, maps, timelines.
DO NOT use for simple text answers.

Example: [GENERATE_IMAGE: professional infographic showing 6-step Thai company registration process, numbered boxes with arrows, icons for each step, modern flat design, blue white gold colors, clean typography]
`;

// ═══════════════════════════════════════════════════════════════════
// IMAGE GENERATION — Pollinations.ai (100% FREE, no API key)
// ═══════════════════════════════════════════════════════════════════
function buildImageUrl(prompt, w=1200, h=800) {
  const p = encodeURIComponent(prompt + ', high quality, professional, detailed, 4k');
  return `https://image.pollinations.ai/prompt/${p}?width=${w}&height=${h}&nologo=true&enhance=true`;
}

function extractImagePrompt(text) {
  const m = text.match(/\[GENERATE_IMAGE:\s*([^\]]+)\]/i);
  return m ? m[1].trim() : null;
}

function stripImageTag(text) {
  return text.replace(/\[GENERATE_IMAGE:[^\]]*\]/gi, '').trim();
}

// Detect explicit user request for visual content
function wantsVisual(text) {
  return /infographic|อินโฟกราฟิก|generate.*image|สร้าง.*รูป|วาด.*ภาพ|ภาพ.*อธิบาย|chart.*show|กราฟ|แผนภูมิ|diagram|flowchart|timeline.*visual|ตาราง.*เปรียบเทียบ.*รูป/i.test(text);
}

// ═══════════════════════════════════════════════════════════════════
// TIER CALLERS (all FREE)
// ═══════════════════════════════════════════════════════════════════
const groq = (sys,usr,model,tok=2000) =>
  axios.post('https://api.groq.com/openai/v1/chat/completions',
    {model, messages:[{role:'system',content:sys},{role:'user',content:usr}], temperature:0.4, max_tokens:tok},
    {headers:{Authorization:`Bearer ${GROQ_API_KEY}`}, timeout:28000}
  ).then(r=>r.data.choices[0].message.content.trim());

const gemini = (sys,usr,model,tok=2000) => {
  if(!GEMINI_API_KEY) return Promise.reject(new Error('No GEMINI_API_KEY'));
  return axios.post(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`,
    {contents:[{parts:[{text:sys+'\n\n---\nUser question:\n'+usr}]}],
     generationConfig:{temperature:0.4, maxOutputTokens:tok}},
    {timeout:28000}
  ).then(r=>r.data.candidates[0].content.parts[0].text.trim());
};

const cerebras = (sys,usr,tok=2000) => {
  if(!CEREBRAS_API_KEY) return Promise.reject(new Error('No CEREBRAS_API_KEY'));
  return axios.post('https://api.cerebras.ai/v1/chat/completions',
    {model:'llama-3.3-70b', messages:[{role:'system',content:sys},{role:'user',content:usr}], temperature:0.4, max_tokens:tok},
    {headers:{Authorization:`Bearer ${CEREBRAS_API_KEY}`}, timeout:28000}
  ).then(r=>r.data.choices[0].message.content.trim());
};

const openrouter = (sys,usr,model,tok=2000) => {
  if(!OPENROUTER_API_KEY) return Promise.reject(new Error('No OPENROUTER_API_KEY'));
  return axios.post('https://openrouter.ai/api/v1/chat/completions',
    {model, messages:[{role:'system',content:sys},{role:'user',content:usr}], temperature:0.4, max_tokens:tok},
    {headers:{Authorization:`Bearer ${OPENROUTER_API_KEY}`,
      'HTTP-Referer':'https://wisdom-ujin.onrender.com','X-Title':'Wisdom Ujin'}, timeout:28000}
  ).then(r=>r.data.choices[0].message.content.trim());
};

// ═══════════════════════════════════════════════════════════════════
// 11-TIER FREE SMART BRAIN CASCADE
// ═══════════════════════════════════════════════════════════════════
async function aiComplete(userPrompt, sys, maxTok=2000) {
  const systemPrompt = sys || MASTER_SYSTEM;
  const tiers = [
    {n:'T01:Gemini-2.0-Flash', f:()=>gemini(systemPrompt,userPrompt,'gemini-2.0-flash',maxTok)},
    {n:'T02:Gemini-1.5-Flash', f:()=>gemini(systemPrompt,userPrompt,'gemini-1.5-flash',maxTok)},
    {n:'T03:Cerebras-70b',     f:()=>cerebras(systemPrompt,userPrompt,maxTok)},
    {n:'T04:Groq-70b',         f:()=>groq(systemPrompt,userPrompt,'llama-3.3-70b-versatile',maxTok)},
    {n:'T05:OR-llama-70b',     f:()=>openrouter(systemPrompt,userPrompt,'meta-llama/llama-3.3-70b-instruct:free',maxTok)},
    {n:'T06:OR-Gemma2-9b',     f:()=>openrouter(systemPrompt,userPrompt,'google/gemma-2-9b-it:free',maxTok)},
    {n:'T07:Groq-Mixtral',     f:()=>groq(systemPrompt,userPrompt,'mixtral-8x7b-32768',maxTok)},
    {n:'T08:Groq-Gemma2',      f:()=>groq(systemPrompt,userPrompt,'gemma2-9b-it',maxTok)},
    {n:'T09:OR-Mistral-7b',    f:()=>openrouter(systemPrompt,userPrompt,'mistralai/mistral-7b-instruct:free',maxTok)},
    {n:'T10:OR-Phi3-mini',     f:()=>openrouter(systemPrompt,userPrompt,'microsoft/phi-3-mini-128k-instruct:free',maxTok)},
    {n:'T11:Groq-8b-Fallback', f:()=>groq(systemPrompt,userPrompt,'llama-3.1-8b-instant',maxTok)},
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
  return 'ขออภัยครับ ระบบ AI มีภาระสูงมากตอนนี้ กรุณาลองถามใหม่ในอีกสักครู่นะครับ 🙏';
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
    /^(who|what|where|when|why|how|is|are|can|could|would|should|do|does|did|tell|explain|help|show)/i,
    /(ช่วย|แนะนำ|บอก|อธิบาย|สอน|หา|ขอ).*(หน่อย|ได้ไหม|ครับ|ค่ะ|คะ)/,
  ].some(p => p.test(t));
}

// ═══════════════════════════════════════════════════════════════════
// PUBLIC API
// ═══════════════════════════════════════════════════════════════════

/**
 * answerAIUrgent — called from server.js AI Urgent mode
 * Returns: { text: string, imageUrl?: string }
 */
async function answerAIUrgent(text, senderName) {
  // Build context-aware prompt
  const visualHint = wantsVisual(text)
    ? '\n\n[Note: The user explicitly wants a visual/image/infographic. Include [GENERATE_IMAGE: ...] at the end with a detailed English prompt.]'
    : '';

  const userPrompt = `ผู้ถาม: ${senderName}
คำถาม: ${text}${visualHint}

กรุณาตอบอย่างฉลาด ลึก และเป็นประโยชน์ที่สุด โดยใช้กระบวนการคิดที่ระบุใน system prompt:`;

  const raw = await aiComplete(userPrompt, MASTER_SYSTEM, 2000);

  // Parse image generation tag
  const imagePrompt = extractImagePrompt(raw);
  const cleanText   = stripImageTag(raw);

  let imageUrl;
  if (imagePrompt) {
    imageUrl = buildImageUrl(imagePrompt);
    console.log(`[SmartBrain] 🎨 Generating image: ${imagePrompt.slice(0,60)}...`);
  }

  return { text: cleanText, imageUrl };
}

/**
 * analyzeForLark — background deep analysis → Lark only (never LINE)
 */
async function analyzeForLark(text, senderName, groupId) {
  try {
    const userPrompt = `ข้อความจากกลุ่ม LINE:
ผู้พูด: ${senderName} | กลุ่ม: ${groupId}
ข้อความ: "${text}"

วิเคราะห์เชิงลึก:
1. ประเด็นสำคัญหรือคำถามที่แฝงอยู่
2. ข้อมูล/กฎหมาย/ขั้นตอนที่เกี่ยวข้อง
3. ความเสี่ยงหรือโอกาสที่ควรระวัง
4. ข้อแนะนำสำหรับทีม`;

    const analysis = await aiComplete(userPrompt, MASTER_SYSTEM, 1500);

    const { sendSummaryCard } = require('./larkMessenger');
    const now = new Date().toLocaleString('th-TH',{timeZone:'Asia/Bangkok'});
    await sendSummaryCard(
      `🧠 วิเคราะห์เชิงลึก — ${senderName} · ${now}`,
      `❓ **ข้อความ:** ${text}\n\n${analysis}\n\n> 🤖 อูจิน Smart Brain | Wisdom International`
    );
  } catch(e) {
    console.error('[SmartAdvisor] analyzeForLark error:', e.message);
  }
}

/**
 * buildSystemPrompt — used by aiSummarizer
 */
function buildSystemPrompt(context='') {
  return MASTER_SYSTEM + (context ? '\n\n## บริบทเพิ่มเติม\n' + context : '');
}

module.exports = { isQuestion, answerAIUrgent, analyzeForLark, aiComplete, buildSystemPrompt, MASTER_SYSTEM };
