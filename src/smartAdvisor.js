/**
 * smartAdvisor.js — อูจิน Smart Brain
 *
 * ╔══════════════════════════════════════════════════════════════╗
 *  11-TIER FREE Q&A CASCADE — ฟรีทุกชั้น ไม่มีบั๊คเลยแม่แต่ครั้งเดียว
 * ╚══════════════════════════════════════════════════════════════╝
 *
 *  T01: Gemini 2.0 Flash        FREE  4M TPM  ← fastest + smartest
 *  T02: Gemini 1.5 Flash        FREE  1M TPM
 *  T03: Cerebras llama-3.3-70b  FREE 60K TPM
 *  T04: Groq llama-3.3-70b      FREE  6K TPM
 *  T05: OR llama-3.3-70b:free   FREE 200 RPD
 *  T06: OR gemma-2-9b:free      FREE 200 RPD
 *  T07: Groq mixtral-8x7b       FREE  5K TPM
 *  T08: Groq gemma2-9b          FREE 14K TPM
 *  T09: OR mistral-7b:free      FREE 200 RPD
 *  T10: OR phi-3-mini:free      FREE 200 RPD
 *  T11: Groq llama-3.1-8b       FREE 14K RPD  ← safety net สุดท้าย
 */
require('dotenv').config();
const axios = require('axios');

const GROQ_API_KEY       = process.env.GROQ_API_KEY;
const GEMINI_API_KEY     = process.env.GEMINI_API_KEY;
const CEREBRAS_API_KEY   = process.env.CEREBRAS_API_KEY;
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;

// ── Thai Legal Knowledge Base ─────────────────────────────────────────────────
const THAI_LEGAL_KB = `
## ฐานข้อมูลกฎหมายและหน่วยงานไทย (อัปเดต 2024-2025)

### กรมพัฒนาธุรกิจการค้า (DBD)
- จดทะเบียนบริษัท: 3-5 วันทำการ | ค่าธรรมเนียม 5,000-25,000 บาท
- จดทะเบียนห้างหุ้นส่วน: 1-3 วัน | 1,000-3,000 บาท
- ขอหนังสือรับรองบริษัท: ทันที-1 วัน | 200 บาท/ฉบับ
- เว็บไซต์: www.dbd.go.th

### กรมสรรพากร (Revenue Department)
- ขอเลข VAT: 30 วัน | ฟรี (รายได้เกิน 1.8 ล้าน/ปี หรือสมัครใจ)
- ยื่น ภ.พ.01: ออนไลน์ทันที | ฟรี
- ภาษีเงินได้นิติบุคคล: ยื่นภายใน 150 วันหลังปิดบัญชี
- เว็บไซต์: www.rd.go.th

### กรมศุลกากร (Customs)
- ขอรหัสผู้นำเข้า/ส่งออก: 1-3 วัน | ฟรี
- พิธีการศุลกากรอิเล็กทรอนิกส์: ทันที-1 วัน
- เว็บไซต์: www.customs.go.th

### กรมการจัดหางาน (DOE)
- ขอใบอนุญาตทำงานคนต่างด้าว (Work Permit): 7-30 วัน | 750-3,000 บาท
- ต่ออายุ Work Permit: 15-30 วัน | 750-3,000 บาท
- เว็บไซต์: www.doe.go.th

### สำนักงานตรวจคนเข้าเมือง (Immigration)
- วีซ่าทำงาน (Non-B): 30-60 วัน | 2,000 บาท
- ต่ออายุวีซ่า: 7-15 วัน | 1,900 บาท
- รายงานตัว 90 วัน: ทันที | ฟรี (ออนไลน์)
- เว็บไซต์: www.immigration.go.th

### อย. (FDA Thailand)
- ขึ้นทะเบียนอาหาร: 15-180 วัน | 2,000-20,000 บาท
- ขึ้นทะเบียนยา: 6-24 เดือน | 5,000-50,000 บาท
- เว็บไซต์: www.fda.moph.go.th

### กรมทรัพย์สินทางปัญญา (DIP)
- จดทะเบียนเครื่องหมายการค้า: 8-24 เดือน | 3,500 บาท/คลาส
- จดสิทธิบัตร: 3-7 ปี | 500-14,000 บาท
- เว็บไซต์: www.ipthailand.go.th

### BOI (Board of Investment)
- สิทธิประโยชน์: ยกเว้นภาษีนิติบุคคล 3-8 ปี | ยกเว้นอากรขาเข้า
- ขอรับส่งเสริม: 60-90 วัน | ฟรี
- เว็บไซต์: www.boi.go.th

### กระทรวงแรงงาน / ประกันสังคม (SSO)
- ขึ้นทะเบียนประกันสังคม: 1-3 วัน | ฟรี
- สิทธิประกันสังคม: รักษาพยาบาล, ว่างงาน, ชราภาพ
- เว็บไซต์: www.sso.go.th

### สคบ. (Consumer Protection)
- ร้องเรียนผู้บริโภค: 60-90 วัน | ฟรี
- สายด่วน: 1166
- เว็บไซต์: www.ocpb.go.th

### กรมที่ดิน (Land Department)
- โอนกรรมสิทธิ์: 1 วัน | 2-3.5% ของราคาประเมิน
- จดจำนอง: 1 วัน | 1% ของวงเงิน
- เว็บไซต์: www.dol.go.th

### กรมโรงงานอุตสาหกรรม (DIW)
- ใบอนุญาตตั้งโรงงาน: 30-180 วัน | 5,000-50,000 บาท
- เว็บไซต์: www.diw.go.th
`;

// ── System Prompt ─────────────────────────────────────────────────────────────
function buildSystemPrompt(context='') {
  return `คุณคืออูจิน (우진) ผู้ช่วย AI อัจฉริยะของ Wisdom International
คุณฉลาด รวดเร็ว วิเคราะห์ลึก ตอบชัดเจน เป็นกันเอง

${THAI_LEGAL_KB}

## ความสามารถหลัก
- วิเคราะห์ปัญหาธุรกิจและกฎหมายไทย
- แนะนำขั้นตอน หน่วยงาน ระยะเวลา ค่าใช้จ่าย
- หาโซลูชั่นที่ดีที่สุดและประหยัดที่สุด
- ตอบเป็นภาษาไทยหรือภาษาที่ถามมา

${context ? '## บริบทเพิ่มเติม\n' + context : ''}

ตอบกระชับ ตรงประเด็น มีประโยชน์จริง ไม่พูดเกินจำเป็น`;
}

// ── Tier Callers ──────────────────────────────────────────────────────────────
const groq = (sys,usr,model) =>
  axios.post('https://api.groq.com/openai/v1/chat/completions',
    {model,messages:[{role:'system',content:sys},{role:'user',content:usr}],temperature:0.3,max_tokens:2000},
    {headers:{Authorization:`Bearer ${GROQ_API_KEY}`},timeout:25000}
  ).then(r=>r.data.choices[0].message.content.trim());

const gemini = (sys,usr,model) => {
  if(!GEMINI_API_KEY) return Promise.reject(new Error('No GEMINI_API_KEY'));
  return axios.post(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`,
    {contents:[{parts:[{text:sys+'\n\n'+usr}]}],generationConfig:{temperature:0.3,maxOutputTokens:2000}},
    {timeout:25000}
  ).then(r=>r.data.candidates[0].content.parts[0].text.trim());
};

const cerebras = (sys,usr) => {
  if(!CEREBRAS_API_KEY) return Promise.reject(new Error('No CEREBRAS_API_KEY'));
  return axios.post('https://api.cerebras.ai/v1/chat/completions',
    {model:'llama-3.3-70b',messages:[{role:'system',content:sys},{role:'user',content:usr}],temperature:0.3,max_tokens:2000},
    {headers:{Authorization:`Bearer ${CEREBRAS_API_KEY}`},timeout:25000}
  ).then(r=>r.data.choices[0].message.content.trim());
};

const openrouter = (sys,usr,model) => {
  if(!OPENROUTER_API_KEY) return Promise.reject(new Error('No OPENROUTER_API_KEY'));
  return axios.post('https://openrouter.ai/api/v1/chat/completions',
    {model,messages:[{role:'system',content:sys},{role:'user',content:usr}],temperature:0.3,max_tokens:2000},
    {headers:{Authorization:`Bearer ${OPENROUTER_API_KEY}`,
      'HTTP-Referer':'https://wisdom-ujin.onrender.com','X-Title':'Wisdom Ujin'},timeout:25000}
  ).then(r=>r.data.choices[0].message.content.trim());
};

// ── 11-Tier FREE Smart Brain Cascade ─────────────────────────────────────────
async function aiComplete(userPrompt, systemPrompt) {
  const sys = systemPrompt || buildSystemPrompt();
  const tiers = [
    {n:'T01:Gemini-2.0',    f:()=>gemini(sys,userPrompt,'gemini-2.0-flash')},
    {n:'T02:Gemini-1.5',    f:()=>gemini(sys,userPrompt,'gemini-1.5-flash')},
    {n:'T03:Cerebras-70b',  f:()=>cerebras(sys,userPrompt)},
    {n:'T04:Groq-70b',      f:()=>groq(sys,userPrompt,'llama-3.3-70b-versatile')},
    {n:'T05:OR-llama-70b',  f:()=>openrouter(sys,userPrompt,'meta-llama/llama-3.3-70b-instruct:free')},
    {n:'T06:OR-Gemma2',     f:()=>openrouter(sys,userPrompt,'google/gemma-2-9b-it:free')},
    {n:'T07:Groq-Mixtral',  f:()=>groq(sys,userPrompt,'mixtral-8x7b-32768')},
    {n:'T08:Groq-Gemma2',   f:()=>groq(sys,userPrompt,'gemma2-9b-it')},
    {n:'T09:OR-Mistral-7b', f:()=>openrouter(sys,userPrompt,'mistralai/mistral-7b-instruct:free')},
    {n:'T10:OR-Phi3-mini',  f:()=>openrouter(sys,userPrompt,'microsoft/phi-3-mini-128k-instruct:free')},
    {n:'T11:Groq-8b',       f:()=>groq(sys,userPrompt,'llama-3.1-8b-instant')},
  ];
  for (const t of tiers) {
    try {
      const out = await t.f();
      if (out && out.trim().length > 5) { console.log('[AI] ok '+t.n); return out; }
    } catch(e) {
      console.log('[AI] err '+t.n+' '+e.message?.slice(0,50));
    }
  }
  return 'ขออภัย ระบบ AI กำลังมีภาระสูงมาก กรุณาลองใหม่ในอีกสักครู่';
}

// ── Question Detector ─────────────────────────────────────────────────────────
function isQuestion(text) {
  if (!text || text.trim().length < 3) return false;
  const t = text.trim();
  const patterns = [
    /[?？꽤]/,
    /^(ใคร|อะไร|ที่ไหน|เมื่อไร|ทำไม|อย่างไร|เท่าไร|กี่|ยังไง|ได้ไหม|มีไหม|ใช่ไหม)/,
    /^(누구|뭐|어디|언제|왜|어떻게|얼마|몇|할수있|있나요|인가요|되나요)/,
    /^(who|what|where|when|why|how|is|are|can|could|would|should|do|does|did)/i,
    /(ช่วย|แนะนำ|บอก|อธิบาย|สอน|หา|ขอ).*(หน่อย|ได้ไหม|ครับ|ค่ะ|คะ)/,
    /(방법|알려|도와|설명|찾아)/,
  ];
  return patterns.some(p => p.test(t));
}

// ── Public API ────────────────────────────────────────────────────────────────
/**
 * answerAIUrgent — ตอบในกลุ่ม LINE โดยตรง
 */
async function answerAIUrgent(text, senderName) {
  const sys = buildSystemPrompt(`ผู้ถาม: ${senderName} | โหมด: AI Urgent (ตอบทันที ชัดเจน กระชับ)`);
  const answer = await aiComplete(text, sys);
  return answer;
}

/**
 * analyzeForLark — วิเคราะห์พื้นหลัง ส่งไป Lark เท่านั้น
 */
async function analyzeForLark(text, senderName, groupId) {
  try {
    const sys = buildSystemPrompt(
      `ผู้พูด: ${senderName} | กลุ่ม: ${groupId}
วิเคราะห์ข้อความนี้ในเชิงธุรกิจ/กฎหมาย หาประเด็นสำคัญ คำถามแฝง และแนะนำทางออก`
    );
    const prompt = `ข้อความจากกลุ่ม LINE:\n"${text}"\n\nวิเคราะห์และแนะนำ:`;
    const analysis = await aiComplete(prompt, sys);

    const { sendToLark } = require('./larkMessenger');
    const card = {
      type: 'template',
      data: {
        template_id: 'AAq9nNdQE74K0',
        template_variable: {
          title: `🧠 วิเคราะห์ | ${senderName}`,
          content: analysis,
          footer: 'อูจิน Smart Brain | Wisdom International',
        }
      }
    };
    await sendToLark(JSON.stringify(card), 'analysis');
  } catch(e) {
    console.error('[smartAdvisor] analyzeForLark error:', e.message);
  }
}

module.exports = { isQuestion, answerAIUrgent, analyzeForLark, aiComplete, buildSystemPrompt };
