/**
 * smartAdvisor.js — อูจิน (우진) Thai Legal & Business Intelligence
 *
 * Features:
 *  1. isQuestion(text)          — detect questions/problems
 *  2. analyzeForLark(...)       — background analysis → Lark ONLY (silent)
 *  3. answerAIUrgent(...)       — Gemini Flash priority → return answer for LINE reply
 *
 * "AI Urgent" mode: activated by keyword in LINE → bot answers IN the group
 * Regular questions: detected silently → analysis sent to Lark team room only
 */
require('dotenv').config();
const axios = require('axios');
const { sendSummaryCard } = require('./larkMessenger');

// ── API Keys ───────────────────────────────────────────────────────────────────
const GEMINI_API_KEY     = process.env.GEMINI_API_KEY;
const GROQ_API_KEY       = process.env.GROQ_API_KEY;
const CEREBRAS_API_KEY   = process.env.CEREBRAS_API_KEY;
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;

// ── Thai Legal & Government Knowledge Base ────────────────────────────────────
const THAI_LEGAL_KB = `
=== ฐานข้อมูลหน่วยงานรัฐไทยและขั้นตอนจริง (อัปเดต 2567) ===

🏢 กรมพัฒนาธุรกิจการค้า (DBD) | dbd.go.th | โทร 1570
• จดทะเบียนบริษัทจำกัด: 1-3 วันทำการ (ระบบ e-Registration) | ทุน 1 ล้าน = ค่าธรรมเนียม 5,500 บาท
• จดทะเบียนห้างหุ้นส่วนจำกัด: 1-2 วัน | 1,000 บาท
• แก้ไขข้อมูลบริษัท (กรรมการ/ที่อยู่/ทุน): 1-3 วัน | 500-1,000 บาท
• ขั้นตอน: จองชื่อ (ฟรี) → จัดทำหนังสือบริคณห์สนธิ → ประชุมจัดตั้ง → จดทะเบียน
• Online: dbdregistration.dbd.go.th | DBD e-Service

💰 กรมสรรพากร (Revenue Dept.) | rd.go.th | โทร 1161
• สมัคร VAT: เมื่อรายได้ >1.8 ล้าน/ปี | ฟรี | สมัครได้ทันที | ยื่น ภ.พ.01
• ภาษีนิติบุคคล: ยื่น ภ.ง.ด.50 ภายใน 150 วันหลังสิ้นรอบบัญชี
• ภาษีหัก ณ ที่จ่าย (WHT): ยื่น ภ.ง.ด.1,3,53 ทุกเดือน ภายในวันที่ 7
• e-Withholding Tax: หักผ่านธนาคาร อัตรา 1.5% (ลดจาก 3%)
• ยื่น Online: efiling.rd.go.th

🚢 กรมศุลกากร (Customs) | customs.go.th | โทร 1164
• ลงทะเบียนผู้นำเข้า-ส่งออก: 1-3 วัน | ฟรี | ต้องมีหนังสือรับรองบริษัท+บัตรประชาชน
• ตรวจสอบ HS Code และอัตราภาษี: customs.go.th/page.php?id=2
• สินค้าต้องขออนุญาตพิเศษ: อาหาร(อย.) ยา(อย.) อาวุธ(กรมการปกครอง) สัตว์(กรมปศุสัตว์)
• ภาษีนำเข้าโดยเฉลี่ย: 0-30% ขึ้นกับประเภทสินค้า | บาง FTA ลดเหลือ 0%
• สินค้าติดศุลกากร: ติดต่อ 1164 และเตรียม Invoice+Packing List+B/L+Certificate

👷 กรมการจัดหางาน (DOE) | doe.go.th | โทร 1506
• Work Permit (ต่างชาติ): 7-30 วัน | 750-3,000 บาท/ปี | ต่ออายุทุกปี
• เงื่อนไข WP: Non-B Visa + สัญญาจ้างงาน + บริษัทมีทุนจด ≥2 ล้านบาท/คน
• สัดส่วน: คนไทย 4 คน : ต่างชาติ 1 คน (บางกิจการยกเว้น)
• แรงงาน MOU (พม่า/กัมพูชา/ลาว/เวียดนาม): OSS 1 stop ที่กรมจัดหางาน | 3,000-8,000 บาท
• ตรวจสอบสถานะ: e-workpermit.doe.go.th

🛂 สำนักงานตรวจคนเข้าเมือง (Immigration) | immigration.go.th | โทร 0-2141-9889
• Non-B Visa (Business/Work): ต่ออายุที่ตม. | 1,900 บาท | ทุก 1 ปี
• เอกสาร: หนังสือรับรองบริษัท + สัญญาจ้าง + Work Permit + ทะเบียนภาษี
• ขยายพำนัก: ยื่นก่อนวีซ่าหมด 30 วัน | 1,900 บาท
• Smart Visa (BOI): 4 ปี | ไม่ต้องมี Work Permit | เฉพาะกิจการเป้าหมาย BOI
• 90-day Report: แจ้งทุก 90 วัน ออนไลน์ที่ tm47.immigration.go.th | ฟรี

💊 อย./FDA | fda.moph.go.th | โทร 1556
• อาหาร: แจ้งรายละเอียดอาหาร (อ.1) 1-3 วัน ฟรี | ขอ อ.9 (ขออนุญาต) 30-60 วัน 1,000-5,000 บาท
• เครื่องสำอาง: แจ้งจดแจ้ง 1-3 วัน | 200-1,000 บาท | เว็บ cosmetic.fda.moph.go.th
• ยา: ขึ้นทะเบียน 3-24 เดือน | 2,000-10,000 บาท | ต้องมี GMP
• อาหารเสริม (OTOP): ฉลาก+ขึ้นทะเบียน 15-30 วัน | 500-1,000 บาท
• นำเข้าอาหาร/ยา: ต้องมีใบอนุญาต อย.ไทย ก่อนผ่านด่านศุลกากร

™️ กรมทรัพย์สินทางปัญญา (DIP) | ipthailand.go.th | โทร 0-2547-4688
• เครื่องหมายการค้า: 18-24 เดือน | 500 บาท/หมวด (35 หมวด) | ต่ออายุทุก 10 ปี
• ลิขสิทธิ์: เกิดอัตโนมัติเมื่อสร้างผลงาน | แจ้งข้อมูลที่ DIP ฟรี | ไม่ต้องจดทะเบียน
• สิทธิบัตรการประดิษฐ์: 3-5 ปี | 2,000-10,000 บาท | คุ้มครอง 20 ปี
• สิทธิบัตรการออกแบบ: 6-12 เดือน | 500 บาท | คุ้มครอง 10 ปี

🏭 กรมโรงงานอุตสาหกรรม (DIW) | diw.go.th | โทร 0-2202-4000
• โรงงาน จ.3 (>50 แรงม้า): ขอ ร.ง.4 ใช้เวลา 30-90 วัน | ค่าธรรมเนียมตามขนาด
• โรงงาน จ.2 (5-50 แรงม้า): แจ้งอุตสาหกรรมจังหวัด | ง่ายกว่า
• โรงงาน จ.1 (<5 แรงม้า): แจ้งอำเภอ | ไม่ต้องขออนุญาต
• EIA: โรงงานขนาดใหญ่ต้องทำ EIA ก่อน ใช้เวลา 6-12 เดือน

💼 สำนักงานคณะกรรมการส่งเสริมการลงทุน (BOI) | boi.go.th | โทร 0-2553-8111
• ยกเว้น/ลดภาษีนิติบุคคล 3-8 ปี | ยกเว้นอากรขาเข้าเครื่องจักร
• ต่างชาติถือหุ้น 100% ได้ (ไม่ต้องมีหุ้นส่วนไทย)
• Smart Visa + Non-B 4 ปี
• กิจการเป้าหมาย: ดิจิทัล เทคโนโลยี EV อาหาร เกษตรแปรรูป การแพทย์
• ขั้นตอน: ยื่นคำขอ → ประชุม BOI → ออกบัตรส่งเสริม | 30-60 วัน | ฟรี

👥 กรมสวัสดิการและคุ้มครองแรงงาน | labour.go.th | โทร 1546
• แจ้งขึ้นทะเบียนนายจ้าง: ฟรี | ทันที | ที่กรมแรงงานหรือออนไลน์
• ค่าแรงขั้นต่ำ 2567: 300-400 บาท/วัน (แตกต่างตามจังหวัด กรุงเทพฯ 400 บาท)
• เวลาทำงาน: ≤8 ชม./วัน ≤48 ชม./สัปดาห์ | OT: 1.5-3 เท่า
• ลาพักร้อน: 6 วัน/ปี (ทำงาน 1 ปีขึ้นไป)
• สัญญาจ้าง: ไม่ต้องจดทะเบียน แต่ควรมีเป็นลายลักษณ์อักษร

🛡️ สำนักงานประกันสังคม (SSO) | sso.go.th | โทร 1506
• ขึ้นทะเบียนนายจ้าง+ลูกจ้าง: ฟรี | ภายใน 30 วันที่มีลูกจ้าง
• เงินสมทบ: นายจ้าง 5% + ลูกจ้าง 5% ของเงินเดือน | สูงสุด 750 บาท/เดือน/คน
• สิทธิประกันสังคม: รักษาพยาบาล ทุพพลภาพ ชดเชยว่างงาน เกษียณ คลอดบุตร
• ยื่นเงินสมทบ: ทุกเดือน ภายในวันที่ 15 | e-Payment ได้

🛒 สคบ. (คุ้มครองผู้บริโภค) | ocpb.go.th | โทร 1166
• ร้องเรียนสินค้า/บริการไม่มาตรฐาน: โทร 1166 หรือยื่นออนไลน์
• โฆษณาเกินจริง: โทษปรับ 50,000-500,000 บาท + ถูกดำเนินคดี
• e-Commerce: สิทธิคืนสินค้าภายใน 7 วัน | ผู้ขายต้องชดเชย
• สัญญาผู้บริโภค: มีแบบมาตรฐานบังคับสำหรับอสังหา รถ ประกัน

🏘️ กรมที่ดิน | dol.go.th | โทร 0-2141-5555
• โอนกรรมสิทธิ์ที่ดิน: ค่าธรรมเนียม 2% + ภาษีธุรกิจเฉพาะ 3.3% หรือ ภาษีเงินได้ (แล้วแต่กรณี)
• ต่างชาติซื้อคอนโด: ได้ไม่เกิน 49% ของพื้นที่โครงการ
• เช่าที่ดิน: สัญญาเช่าระยะยาว 30+30 ปี (ต่างชาติใช้ได้)

=== วิธีแก้ปัญหาธุรกิจทั่วไป ===
• ลูกค้าไม่ชำระเงิน: ส่งหนังสือทวงถามก่อน → ฟ้องศาลแขวง (<300,000 บาท ไม่ต้องมีทนาย)
• พนักงานลาออกไม่ได้รับค่าชดเชย: แจ้งกรมแรงงาน 1546 | ฟรี | ไม่เกิน 30 วัน
• สินค้าติดด่านศุลกากร: เตรียม Invoice+Packing List+B/L → ติดต่อ 1164
• ปัญหาภาษีย้อนหลัง: ยื่นอุทธรณ์ต่อคณะกรรมการพิจารณาอุทธรณ์ภายใน 30 วัน
• พิพาทสัญญา: ระงับข้อพิพาท (Mediation) ที่ สคร. ก่อน ประหยัดกว่าฟ้องศาล
• ถูกละเมิดเครื่องหมายการค้า: แจ้งความ + แจ้ง DIP + ฟ้องแพ่ง/อาญา
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
  const t = text.toLowerCase();
  return Q_PATTERNS.some(p => p.test(t)) && text.trim().length > 5;
}

// ── AI Tier Callers ───────────────────────────────────────────────────────────
function isQuotaErr(e){ const s=e.response?.status; return s===429||s===413||s===503; }

const callGemini=(sys,usr,model='gemini-1.5-flash')=>{
  if(!GEMINI_API_KEY) return Promise.reject(new Error('No GEMINI_API_KEY'));
  return axios.post(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`,
    {contents:[{parts:[{text:sys+'\n\n'+usr}]}],generationConfig:{temperature:0.2,maxOutputTokens:2000}},{timeout:28000})
    .then(r=>r.data.candidates[0].content.parts[0].text.trim());
};
const callGroq=(sys,usr,model)=>axios.post('https://api.groq.com/openai/v1/chat/completions',
  {model,messages:[{role:'system',content:sys},{role:'user',content:usr}],temperature:0.2,max_tokens:2000},
  {headers:{Authorization:`Bearer ${GROQ_API_KEY}`},timeout:25000}).then(r=>r.data.choices[0].message.content.trim());
const callCerebras=(sys,usr)=>{
  if(!CEREBRAS_API_KEY) return Promise.reject(new Error('No CEREBRAS_API_KEY'));
  return axios.post('https://api.cerebras.ai/v1/chat/completions',
    {model:'llama-3.3-70b',messages:[{role:'system',content:sys},{role:'user',content:usr}],temperature:0.2,max_tokens:2000},
    {headers:{Authorization:`Bearer ${CEREBRAS_API_KEY}`},timeout:25000}).then(r=>r.data.choices[0].message.content.trim());
};
const callOpenRouter=(sys,usr)=>{
  if(!OPENROUTER_API_KEY) return Promise.reject(new Error('No OPENROUTER_API_KEY'));
  return axios.post('https://openrouter.ai/api/v1/chat/completions',
    {model:'meta-llama/llama-3.3-70b-instruct:free',messages:[{role:'system',content:sys},{role:'user',content:usr}],temperature:0.2,max_tokens:2000},
    {headers:{Authorization:`Bearer ${OPENROUTER_API_KEY}`,'HTTP-Referer':'https://wisdom-ujin.onrender.com','X-Title':'Wisdom อูจิน AI'},timeout:25000})
    .then(r=>r.data.choices[0].message.content.trim());
};

// AI Urgent: Gemini Flash first (smartest + fastest) → full cascade fallback
async function aiUrgentCascade(sys, usr) {
  const tiers = [
    {name:'Gemini-2.0-Flash',fn:()=>callGemini(sys,usr,'gemini-2.0-flash')},
    {name:'Gemini-1.5-Flash',fn:()=>callGemini(sys,usr,'gemini-1.5-flash')},
    {name:'Groq-70b',        fn:()=>callGroq(sys,usr,'llama-3.3-70b-versatile')},
    {name:'Cerebras-70b',    fn:()=>callCerebras(sys,usr)},
    {name:'OpenRouter-70b',  fn:()=>callOpenRouter(sys,usr)},
    {name:'Groq-Mixtral',   fn:()=>callGroq(sys,usr,'mixtral-8x7b-32768')},
    {name:'Groq-8b',         fn:()=>callGroq(sys,usr,'llama-3.1-8b-instant')},
  ];
  for(const t of tiers){
    try{
      const out=await t.fn();
      if(out&&out.length>20){console.log(`[SmartAdvisor] ✓ ${t.name}`);return out;}
    }catch(e){
      const r=isQuotaErr(e)?`quota(${e.response?.status})`:e.message?.startsWith('No ')?'no key':e.message?.slice(0,40);
      console.log(`[SmartAdvisor] ${t.name} ${r} → next`);
    }
  }
  throw new Error('All advisor AI tiers failed');
}

// ── System Prompts ─────────────────────────────────────────────────────────────
const ADVISOR_SYSTEM_PROMPT = `คุณคือ อูจิน (우진) ที่ปรึกษาธุรกิจและกฎหมายไทยผู้เชี่ยวชาญของ Wisdom International
ที่มีความรู้ลึกและทันสมัยในด้านกฎหมาย ราชการ การแก้ปัญหาธุรกิจ และการค้าระหว่างประเทศ

${THAI_LEGAL_KB}

เมื่อได้รับคำถามหรือปัญหา ให้:
1. 🔍 วิเคราะห์ปัญหาให้ชัดเจน — ระบุสาเหตุที่แท้จริง
2. 📋 บอกขั้นตอนที่ต้องทำ — เรียงลำดับ 1,2,3 ชัดเจน
3. 🏛️ ระบุหน่วยงานรับผิดชอบ — ชื่อกรม เบอร์โทร เว็บไซต์
4. ⏱️ บอกระยะเวลาและค่าใช้จ่ายจริง — อย่าประมาณเกินจริง
5. 💡 เสนอโซลูชันหลายทาง — ถ้ามีทางเลือกที่ดีกว่า บอกด้วย
6. ⚠️ เตือนข้อควรระวัง — กับดักทางกฎหมาย/ค่าใช้จ่ายแอบแฝง
7. 🇰🇷 สรุปสั้นๆ เป็นภาษาเกาหลี 1-2 ประโยคท้ายสุด

กฎเหล็ก: ห้ามบอกว่า "ไม่ทราบ" — ถ้าไม่แน่ใจให้แนะนำแหล่งข้อมูลเพิ่มเติม
ตอบเป็นภาษาไทยเป็นหลัก กระชับ ใช้งานได้จริง ไม่เกิน 400 คำ`;

const LARK_ANALYSIS_PROMPT = `คุณคือ อูจิน (우진) นักวิเคราะห์ธุรกิจของ Wisdom International

${THAI_LEGAL_KB}

วิเคราะห์ข้อความต่อไปนี้ว่าเป็นปัญหา/คำถามด้านใด แล้วให้คำแนะนำที่ใช้งานได้จริงสำหรับทีม:

📌 ประเด็นที่ตรวจพบ: [ระบุชัดเจน]
🏛️ หน่วยงานที่เกี่ยวข้อง: [ชื่อกรม + เบอร์โทร]
📋 ขั้นตอนแนะนำ: [เรียงลำดับสั้นๆ]
⏱️ ระยะเวลา/ค่าใช้จ่าย: [ข้อมูลจริง]
💡 ข้อควรระวัง: [กับดักหรือความเสี่ยง]

ตอบสั้น ตรงประเด็น เป็นภาษาไทย`;

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * answerAIUrgent — called when AI Urgent session is active
 * Uses Gemini Flash as primary model for maximum intelligence
 * Returns answer string for LINE reply
 */
async function answerAIUrgent(text, senderName = 'ลูกค้า') {
  const userMsg = `${senderName} ถามว่า: ${text}`;
  return aiUrgentCascade(ADVISOR_SYSTEM_PROMPT, userMsg);
}

/**
 * analyzeForLark — background question analysis, sends result to Lark ONLY
 * Does NOT reply in LINE — silent background intelligence
 */
async function analyzeForLark(text, senderName = 'ผู้ใช้', groupId = 'LINE') {
  try {
    console.log(`[SmartAdvisor] analyzing question from ${senderName}`);
    const userMsg = `ข้อความจาก ${senderName} ในกลุ่ม ${groupId}:\n"${text}"`;
    const analysis = await aiUrgentCascade(LARK_ANALYSIS_PROMPT, userMsg);
    const now = new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' });
    await sendSummaryCard(
      `🧠 อูจินวิเคราะห์คำถาม — ${now}`,
      `❓ **จาก:** ${senderName}\n💬 **คำถาม:** ${text}\n\n${analysis}\n\n> 🤖 วิเคราะห์โดย อูจิน (우진) AI · Wisdom International`
    );
    console.log('[SmartAdvisor] analysis sent to Lark ✓');
  } catch (err) {
    console.error('[SmartAdvisor] analyzeForLark failed:', err.message);
  }
}

module.exports = { isQuestion, answerAIUrgent, analyzeForLark };
