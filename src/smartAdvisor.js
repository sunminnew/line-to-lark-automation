/**
 * smartAdvisor.js — อูจิน (우진) World-Class AI Intelligence Engine
 *
 * ██████████████████████████████████████████████████████████
 *  13-TIER CASCADE FROM 6 AI COMPANIES — ฉลาดที่สุดในโลก
 * ██████████████████████████████████████████████████████████
 *
 *  T01: o1-mini            OpenAI      — Advanced reasoning model
 *  T02: GPT-4o             OpenAI      — Best general intelligence
 *  T03: Claude 3.5 Sonnet  Anthropic   — Top reasoning + analysis
 *  T04: Claude 3.5 Haiku   Anthropic   — Fast + very smart
 *  T05: DeepSeek V3        DeepSeek    — Strongest open-weight model
 *  T06: Gemini 2.0 Flash   Google      — Latest Google AI, free
 *  T07: Gemini 1.5 Pro     Google      — Large context, deep knowledge
 *  T08: GPT-4o-mini        OpenAI      — Fast + affordable
 *  T09: Gemini 1.5 Flash   Google      — 1M TPM free quota
 *  T10: Groq 70b           Groq        — Fastest inference, free
 *  T11: Cerebras 70b       Cerebras    — 60K TPM, blazing fast, free
 *  T12: OpenRouter 70b     OpenRouter  — Free, separate quota pool
 *  T13: Groq 8b            Groq        — Final failsafe
 *
 *  6 บริษัท | 13 โมเดล | quota pool แยกกันทั้งหมด
 *  → ระบบนี้จะไม่มีวันล้มเหลว
 *
 * Routing:
 *  "AI Urgent" keyword → answerAIUrgent() → reply IN LINE (o1-mini first)
 *  Background question → analyzeForLark() → Lark ONLY (silent)
 */
require('dotenv').config();
const axios  = require('axios');
const OpenAI = require('openai');
const { sendSummaryCard } = require('./larkMessenger');

// ── API Keys (add all to Render Environment) ───────────────────────────────────
const OPENAI_API_KEY     = process.env.OPENAI_API_KEY;      // platform.openai.com
const ANTHROPIC_API_KEY  = process.env.ANTHROPIC_API_KEY;   // console.anthropic.com ← NEW
const DEEPSEEK_API_KEY   = process.env.DEEPSEEK_API_KEY;    // platform.deepseek.com ← NEW
const GEMINI_API_KEY     = process.env.GEMINI_API_KEY;      // aistudio.google.com
const GROQ_API_KEY       = process.env.GROQ_API_KEY;        // console.groq.com
const CEREBRAS_API_KEY   = process.env.CEREBRAS_API_KEY;    // cerebras.ai
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;  // openrouter.ai

// ── Thai Legal & Government Knowledge Base (2567) ─────────────────────────────
const THAI_LEGAL_KB = `
=== ฐานข้อมูลหน่วยงานรัฐไทยและขั้นตอนจริง (อัปเดต 2567) ===

🏢 กรมพัฒนาธุรกิจการค้า (DBD) | dbd.go.th | โทร 1570
• จดทะเบียนบริษัทจำกัด: 1-3 วันทำการ (e-Registration) | ทุน 1 ล้าน = 5,500 บาท
• จดทะเบียนห้างหุ้นส่วนจำกัด: 1-2 วัน | 1,000 บาท
• แก้ไขข้อมูลบริษัท (กรรมการ/ที่อยู่/ทุน): 1-3 วัน | 500-1,000 บาท
• ขั้นตอน: จองชื่อ (ฟรี) → จัดทำหนังสือบริคณห์สนธิ → ประชุมจัดตั้ง → จดทะเบียน
• Online: dbdregistration.dbd.go.th | DBD e-Service

💰 กรมสรรพากร | rd.go.th | โทร 1161
• สมัคร VAT: รายได้ >1.8 ล้าน/ปี | ฟรี | ยื่น ภ.พ.01
• ภาษีนิติบุคคล: ยื่น ภ.ง.ด.50 ภายใน 150 วันหลังสิ้นรอบบัญชี
• ภาษีหัก ณ ที่จ่าย: ยื่น ภ.ง.ด.1,3,53 ทุกเดือน ภายในวันที่ 7
• e-Withholding Tax: หักผ่านธนาคาร อัตรา 1.5%

🚢 กรมศุลกากร | customs.go.th | โทร 1164
• ลงทะเบียนผู้นำเข้า-ส่งออก: 1-3 วัน | ฟรี
• สินค้าต้องขออนุญาตพิเศษ: อาหาร(อย.) ยา(อย.) อาวุธ(กรมการปกครอง)
• ภาษีนำเข้า: 0-30% ตาม HS Code | FTA บางประเทศ = 0%
• สินค้าติดศุลกากร: เตรียม Invoice+Packing List+B/L → โทร 1164

👷 กรมการจัดหางาน | doe.go.th | โทร 1506
• Work Permit ต่างชาติ: 7-30 วัน | 750-3,000 บาท/ปี
• เงื่อนไข: Non-B Visa + สัญญาจ้างงาน + ทุนจด ≥2 ล้าน/คน
• สัดส่วน: คนไทย 4 : ต่างชาติ 1
• แรงงาน MOU: OSS | 3,000-8,000 บาท

🛂 ตรวจคนเข้าเมือง | immigration.go.th | โทร 0-2141-9889
• Non-B Visa: 1,900 บาท | ทุก 1 ปี
• Smart Visa (BOI): 4 ปี | ไม่ต้อง Work Permit
• 90-day Report: tm47.immigration.go.th | ฟรี

💊 อย./FDA | fda.moph.go.th | โทร 1556
• อาหาร: 1-60 วัน | ฟรี-5,000 บาท
• เครื่องสำอาง: 1-3 วัน | 200-1,000 บาท
• ยา: 3-24 เดือน | 2,000-10,000 บาท

™️ กรมทรัพย์สินทางปัญญา | ipthailand.go.th | โทร 0-2547-4688
• เครื่องหมายการค้า: 18-24 เดือน | 500 บาท/หมวด | ต่ออายุทุก 10 ปี
• สิทธิบัตร: 3-5 ปี | 2,000-10,000 บาท | คุ้มครอง 20 ปี

💼 BOI | boi.go.th | โทร 0-2553-8111
• ยกเว้น/ลดภาษีนิติบุคคล 3-8 ปี | ยกเว้นอากรเครื่องจักร
• ต่างชาติถือหุ้น 100% | Smart Visa 4 ปี
• กิจการเป้าหมาย: ดิจิทัล EV อาหาร การแพทย์ เทคโนโลยี
• ขั้นตอน: ยื่นคำขอ → ประชุม BOI → ออกบัตรส่งเสริม | 30-60 วัน ฟรี

👥 กรมสวัสดิการแรงงาน | labour.go.th | โทร 1546
• ค่าแรงขั้นต่ำ 2567: 300-400 บาท/วัน (กรุงเทพฯ 400 บาท)
• OT: 1.5-3 เท่า | ลาพักร้อน: 6 วัน/ปี (ทำงานครบ 1 ปี)

🛡️ ประกันสังคม | sso.go.th | โทร 1506
• เงินสมทบ: นายจ้าง 5% + ลูกจ้าง 5% | สูงสุด 750 บาท/คน/เดือน
• ขึ้นทะเบียน: ฟรี | ภายใน 30 วันที่มีลูกจ้าง

🛒 สคบ. | ocpb.go.th | โทร 1166
• ร้องเรียนสินค้าไม่มาตรฐาน | โฆษณาเกินจริง: ปรับ 50,000-500,000 บาท
• e-Commerce: สิทธิคืนสินค้าภายใน 7 วัน

🏘️ กรมที่ดิน | dol.go.th | โทร 0-2141-5555
• โอนกรรมสิทธิ์: ค่าธรรมเนียม 2% + ภาษีธุรกิจเฉพาะ 3.3%
• ต่างชาติซื้อคอนโด: ไม่เกิน 49% ของพื้นที่โครงการ

🏭 กรมโรงงานอุตสาหกรรม | diw.go.th | โทร 0-2202-4000
• ใบอนุญาตโรงงาน จ.3: 30-90 วัน | จ.1 (<5 แรงม้า): แจ้งอำเภอ

=== วิธีแก้ปัญหาธุรกิจทั่วไป ===
• ลูกค้าไม่ชำระเงิน → ส่งหนังสือทวงถาม → ฟ้องศาลแขวง (<300K บาท ไม่ต้องมีทนาย)
• พนักงานไม่ได้ค่าชดเชย → กรมแรงงาน 1546 | ฟรี
• สินค้าติดด่านศุลกากร → เตรียมเอกสาร → โทร 1164
• ปัญหาภาษีย้อนหลัง → อุทธรณ์ภายใน 30 วัน
• พิพาทสัญญา → ไกล่เกลี่ยที่ สคร. ก่อน ประหยัดกว่าฟ้องศาล
• ถูกละเมิดเครื่องหมายการค้า → แจ้งความ + แจ้ง DIP + ฟ้องแพ่ง/อาญา
`;

// ── Question Detector ─────────────────────────────────────────────────────────
const Q_PATTERNS = [
  /\?/, /ยังไง/, /อย่างไร/, /ทำยังไง/, /ทำได้ไหม/, /ใช้เวลา/, /กี่วัน/, /กี่บาท/,
  /ค่าใช้จ่าย/, /ค่าธรรมเนียม/, /ที่ไหน/, /หน่วยงานไหน/, /กรมไหน/,
  /ขั้นตอน/, /วิธี/, /ต้องทำ/, /ต้องยื่น/, /ต้องขอ/, /สามารถ.*ได้/,
  /แก้ปัญหา/, /มีปัญหา/, /ติดปัญหา/, /ทำไม/, /เพราะอะไร/,
  /어디/, /어떻게/, /얼마/, /어떤/, /왜/, /언제/, /뭐/, /무엇/,
  /how\s+to/, /how\s+much/, /where\s+to/, /what\s+is/, /can\s+i/,
];
function isQuestion(text) {
  return Q_PATTERNS.some(p=>p.test(text.toLowerCase())) && text.trim().length > 5;
}

// ── AI Tier Callers ────────────────────────────────────────────────────────────
function isQuotaErr(e){ const s=e.response?.status; return s===429||s===413||s===503; }

// T01-T02, T08: OpenAI (o1-mini, GPT-4o, GPT-4o-mini)
const callOpenAI = (sys, usr, model) => {
  if (!OPENAI_API_KEY) return Promise.reject(new Error('No OPENAI_API_KEY'));
  const openai = new OpenAI({ apiKey: OPENAI_API_KEY });
  // o1 models: no system role, no temperature
  const isO1 = model.startsWith('o1');
  const messages = isO1
    ? [{ role:'user', content: sys + '\n\n' + usr }]
    : [{ role:'system', content:sys }, { role:'user', content:usr }];
  const params = { model, messages, max_tokens: isO1 ? undefined : 2000 };
  if (isO1) params.max_completion_tokens = 2000;
  else params.temperature = 0.2;
  return openai.chat.completions.create(params)
    .then(r => r.choices[0].message.content.trim());
};

// T03-T04: Anthropic Claude (3.5 Sonnet / 3.5 Haiku)
const callClaude = (sys, usr, model) => {
  if (!ANTHROPIC_API_KEY) return Promise.reject(new Error('No ANTHROPIC_API_KEY'));
  return axios.post('https://api.anthropic.com/v1/messages',
    { model, max_tokens:2000, temperature:0.2,
      system: sys, messages:[{ role:'user', content:usr }] },
    { headers:{ 'x-api-key':ANTHROPIC_API_KEY, 'anthropic-version':'2023-06-01',
        'content-type':'application/json' }, timeout:30000 }
  ).then(r => r.data.content[0].text.trim());
};

// T05: DeepSeek V3 (OpenAI-compatible, very capable)
const callDeepSeek = (sys, usr) => {
  if (!DEEPSEEK_API_KEY) return Promise.reject(new Error('No DEEPSEEK_API_KEY'));
  return axios.post('https://api.deepseek.com/v1/chat/completions',
    { model:'deepseek-chat',
      messages:[{role:'system',content:sys},{role:'user',content:usr}],
      temperature:0.2, max_tokens:2000 },
    { headers:{ Authorization:`Bearer ${DEEPSEEK_API_KEY}` }, timeout:25000 }
  ).then(r => r.data.choices[0].message.content.trim());
};

// T06-T07, T09: Google Gemini
const callGemini = (sys, usr, model) => {
  if (!GEMINI_API_KEY) return Promise.reject(new Error('No GEMINI_API_KEY'));
  return axios.post(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`,
    { contents:[{parts:[{text:sys+'\n\n'+usr}]}],
      generationConfig:{ temperature:0.2, maxOutputTokens:2000 } },
    { timeout:28000 }
  ).then(r => r.data.candidates[0].content.parts[0].text.trim());
};

// T10: Groq (llama-3.3-70b / mixtral / 8b)
const callGroq = (sys, usr, model) =>
  axios.post('https://api.groq.com/openai/v1/chat/completions',
    { model, messages:[{role:'system',content:sys},{role:'user',content:usr}],
      temperature:0.2, max_tokens:2000 },
    { headers:{ Authorization:`Bearer ${GROQ_API_KEY}` }, timeout:25000 }
  ).then(r => r.data.choices[0].message.content.trim());

// T11: Cerebras (llama-3.3-70b, 60K TPM)
const callCerebras = (sys, usr) => {
  if (!CEREBRAS_API_KEY) return Promise.reject(new Error('No CEREBRAS_API_KEY'));
  return axios.post('https://api.cerebras.ai/v1/chat/completions',
    { model:'llama-3.3-70b',
      messages:[{role:'system',content:sys},{role:'user',content:usr}],
      temperature:0.2, max_tokens:2000 },
    { headers:{ Authorization:`Bearer ${CEREBRAS_API_KEY}` }, timeout:25000 }
  ).then(r => r.data.choices[0].message.content.trim());
};

// T12: OpenRouter (free llama-3.3-70b)
const callOpenRouter = (sys, usr) => {
  if (!OPENROUTER_API_KEY) return Promise.reject(new Error('No OPENROUTER_API_KEY'));
  return axios.post('https://openrouter.ai/api/v1/chat/completions',
    { model:'meta-llama/llama-3.3-70b-instruct:free',
      messages:[{role:'system',content:sys},{role:'user',content:usr}],
      temperature:0.2, max_tokens:2000 },
    { headers:{ Authorization:`Bearer ${OPENROUTER_API_KEY}`,
        'HTTP-Referer':'https://wisdom-ujin.onrender.com',
        'X-Title':'Wisdom อูจิน AI — World-Class Bot' },
      timeout:25000 }
  ).then(r => r.data.choices[0].message.content.trim());
};

// ── 13-Tier World-Class Cascade ────────────────────────────────────────────────
async function aiUrgentCascade(sys, usr) {
  const tiers = [
    { name:'T01:o1-mini',           fn:()=>callOpenAI(sys, usr, 'o1-mini') },
    { name:'T02:GPT-4o',            fn:()=>callOpenAI(sys, usr, 'gpt-4o') },
    { name:'T03:Claude-3.5-Sonnet', fn:()=>callClaude(sys, usr, 'claude-3-5-sonnet-20241022') },
    { name:'T04:Claude-3.5-Haiku',  fn:()=>callClaude(sys, usr, 'claude-3-5-haiku-20241022') },
    { name:'T05:DeepSeek-V3',       fn:()=>callDeepSeek(sys, usr) },
    { name:'T06:Gemini-2.0-Flash',  fn:()=>callGemini(sys, usr, 'gemini-2.0-flash') },
    { name:'T07:Gemini-1.5-Pro',    fn:()=>callGemini(sys, usr, 'gemini-1.5-pro') },
    { name:'T08:GPT-4o-mini',       fn:()=>callOpenAI(sys, usr, 'gpt-4o-mini') },
    { name:'T09:Gemini-1.5-Flash',  fn:()=>callGemini(sys, usr, 'gemini-1.5-flash') },
    { name:'T10:Groq-70b',          fn:()=>callGroq(sys, usr, 'llama-3.3-70b-versatile') },
    { name:'T11:Cerebras-70b',      fn:()=>callCerebras(sys, usr) },
    { name:'T12:OpenRouter-70b',    fn:()=>callOpenRouter(sys, usr) },
    { name:'T13:Groq-8b',           fn:()=>callGroq(sys, usr, 'llama-3.1-8b-instant') },
  ];

  for (const t of tiers) {
    try {
      const out = await t.fn();
      if (out && out.trim().length > 20) {
        console.log(`[SmartAdvisor] ✓ ${t.name}`);
        return out;
      }
      console.log(`[SmartAdvisor] ${t.name} empty → next`);
    } catch(e) {
      const r = isQuotaErr(e) ? `quota(${e.response?.status})`
              : e.message?.startsWith('No ') ? 'no key'
              : e.message?.slice(0, 50);
      console.log(`[SmartAdvisor] ${t.name} ${r} → next`);
    }
  }
  throw new Error('[SmartAdvisor] All 13 tiers failed');
}

// ── System Prompts ─────────────────────────────────────────────────────────────
const ADVISOR_SYSTEM_PROMPT = `คุณคือ อูจิน (우진) ที่ปรึกษาธุรกิจและกฎหมายไทยระดับ World-Class ของ Wisdom International
ที่มีความรู้ลึก ทันสมัย และแม่นยำในด้านกฎหมายไทย ราชการ การแก้ปัญหาธุรกิจ และการค้าระหว่างไทย-เกาหลี

${THAI_LEGAL_KB}

เมื่อได้รับคำถามหรือปัญหา:
1. 🔍 วิเคราะห์ปัญหา — ระบุสาเหตุที่แท้จริง ไม่ใช่แค่อาการ
2. 📋 ขั้นตอนที่ต้องทำ — เรียงลำดับ 1,2,3 ชัดเจน ทำได้ทันที
3. 🏛️ หน่วยงานรับผิดชอบ — ชื่อกรม เบอร์โทร เว็บไซต์
4. ⏱️ ระยะเวลาและค่าใช้จ่ายจริง — ข้อมูลเฉพาะเจาะจง ไม่กำกวม
5. 💡 โซลูชันหลายทาง — ทางเลือกที่ดีที่สุด ประหยัดที่สุด เร็วที่สุด
6. ⚠️ ข้อควรระวัง — กับดักทางกฎหมาย ค่าใช้จ่ายแอบแฝง ความเสี่ยง
7. 🇰🇷 สรุปภาษาเกาหลี — 1-2 ประโยคท้ายสุดสำหรับทีมเกาหลี

กฎเหล็ก:
• ห้ามบอกว่า "ไม่ทราบ" — ให้แนะนำแหล่งข้อมูลเพิ่มเติมแทน
• ใช้ข้อมูลจริงจากฐานข้อมูลด้านบน ไม่คาดเดา
• ตอบภาษาไทยเป็นหลัก กระชับ ใช้งานได้จริง ไม่เกิน 400 คำ`;

const LARK_ANALYSIS_PROMPT = `คุณคือ อูจิน (우진) นักวิเคราะห์ธุรกิจ World-Class ของ Wisdom International

${THAI_LEGAL_KB}

วิเคราะห์ข้อความต่อไปนี้ แล้วให้คำแนะนำที่ใช้งานได้จริงสำหรับทีม:

📌 ประเด็น: [ระบุชัดเจน]
🏛️ หน่วยงาน: [ชื่อกรม + เบอร์]
📋 ขั้นตอน: [เรียงลำดับ]
⏱️ เวลา/ค่าใช้จ่าย: [ข้อมูลจริง]
💡 ข้อควรระวัง: [ความเสี่ยง]

ตอบสั้น ตรงประเด็น ภาษาไทย`;

// ── Public API ─────────────────────────────────────────────────────────────────
async function answerAIUrgent(text, senderName='ลูกค้า') {
  return aiUrgentCascade(ADVISOR_SYSTEM_PROMPT, `${senderName} ถามว่า: ${text}`);
}

async function analyzeForLark(text, senderName='ผู้ใช้', groupId='LINE') {
  try {
    const analysis = await aiUrgentCascade(
      LARK_ANALYSIS_PROMPT,
      `ข้อความจาก ${senderName} ในกลุ่ม ${groupId}:\n"${text}"`
    );
    const now = new Date().toLocaleString('th-TH',{timeZone:'Asia/Bangkok'});
    await sendSummaryCard(
      `🧠 อูจินวิเคราะห์คำถาม — ${now}`,
      `❓ **จาก:** ${senderName}\n💬 **คำถาม:** ${text}\n\n${analysis}\n\n> 🌍 วิเคราะห์โดย อูจิน (우진) 13-Tier World-Class AI · Wisdom International`
    );
    console.log('[SmartAdvisor] ✓ analysis sent to Lark');
  } catch(err) {
    console.error('[SmartAdvisor] analyzeForLark failed:',err.message);
  }
}

module.exports = { isQuestion, answerAIUrgent, analyzeForLark };
