/**
 * lineHandler.js
 * Bidirectional translation: Thai<->Korean via Groq API (free tier) + Gemini fallback.
 * Fallback chain: openai/gpt-oss-20b -> openai/gpt-oss-120b -> Gemini 3.6 Flash
 */
const axios = require('axios');
const crypto = require('crypto');

const LINE_API_BASE  = 'https://api.line.me/v2/bot';
const ACCESS_TOKEN   = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET;
const GROQ_API_KEY   = process.env.GROQ_API_KEY;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || null; // optional — activates 4th fallback

const OOO_MESSAGE =
  '\u0e2a\u0e27\u0e31\u0e2a\u0e14\u0e35\u0e04\u0e48\u0e32/\u0e04\u0e23\u0e31\u0e1a \u0e02\u0e13\u0e30\u0e19\u0e35\u0e49\u0e2d\u0e22\u0e39\u0e48\u0e19\u0e2d\u0e01\u0e40\u0e27\u0e25\u0e32\u0e17\u0e33\u0e01\u0e32\u0e23 (09.00-18.00 \u0e19.) ' +
  '\u0e17\u0e32\u0e07\u0e17\u0e35\u0e21\u0e07\u0e32\u0e19\u0e44\u0e14\u0e49\u0e23\u0e31\u0e1a\u0e02\u0e49\u0e2d\u0e04\u0e27\u0e32\u0e21\u0e02\u0e2d\u0e07\u0e17\u0e48\u0e32\u0e19\u0e41\u0e25\u0e49\u0e27 \u0e41\u0e25\u0e30\u0e08\u0e30\u0e23\u0e35\u0e1a\u0e15\u0e34\u0e14\u0e15\u0e48\u0e2d\u0e01\u0e25\u0e31\u0e1a\u0e17\u0e31\u0e19\u0e17\u0e35\u0e43\u0e19\u0e40\u0e27\u0e25\u0e32\u0e17\u0e33\u0e01\u0e32\u0e23 ' +
  '\u0e02\u0e2d\u0e1a\u0e1e\u0e23\u0e30\u0e04\u0e38\u0e13\u0e17\u0e35\u0e48\u0e44\u0e27\u0e49\u0e27\u0e32\u0e07\u0e43\u0e08\u0e04\u0e48\u0e32/\u0e04\u0e23\u0e31\u0e1a';

const THAI_REGEX    = /[\u0e00-\u0e7f]/;
const KOREAN_REGEX  = /[\uac00-\ud7af\u1100-\u11ff\u3130-\u318f]/;
const ENGLISH_REGEX = /[a-zA-Z]/;

function verifySignature(rawBody, signature) {
  const hmac = crypto.createHmac('SHA256', CHANNEL_SECRET);
  hmac.update(rawBody);
  return hmac.digest('base64') === signature;
}

// ── Repetition loop detector ────────────────────────────────────────────────
function isRepetitive(text) {
  if (!text || text.length < 20) return false;
  // 1. Single-character dominance (catches ๆๆๆ... hallucinations)
  var clean = text.replace(/\s/g, '');
  if (clean.length > 30) {
    var freq = {};
    for (var c of clean) freq[c] = (freq[c] || 0) + 1;
    var maxFreq = Math.max(...Object.values(freq));
    if (maxFreq / clean.length > 0.25) return true;
  }
  // 2. Output much longer than would be sensible (> 5x typical translation ratio)
  if (text.length > 4000) return true;
  // 3. Word-trigram repetition (original check)
  if (text.length < 100) return false;
  var tokens = text.trim().split(/\s+/);
  if (tokens.length < 10) return false;
  var seen = {};
  for (var i = 0; i < tokens.length - 2; i++) {
    var trigram = tokens[i] + ' ' + tokens[i+1] + ' ' + tokens[i+2];
    if (seen[trigram]) return true;
    seen[trigram] = true;
  }
  return false;
}

// ── Output cleaners ──────────────────────────────────────────────────────────
function cleanKorean(t) {
  return t.split('').filter(function(c) {
    var n = c.charCodeAt(0);
    return (n >= 0xAC00 && n <= 0xD7AF) || (n >= 0x1100 && n <= 0x11FF) ||
           (n >= 0x3130 && n <= 0x318F) || (n >= 0x41 && n <= 0x5A) ||
           (n >= 0x61 && n <= 0x7A) || n === 32 || n === 10 || n === 9 ||
           (n >= 0x30 && n <= 0x39);
  }).join('').trim();
}

function cleanThai(t) {
  return t.split('').filter(function(c) {
    var n = c.charCodeAt(0);
    return (n >= 0x0E00 && n <= 0x0E7F) || (n >= 0x41 && n <= 0x5A) ||
           (n >= 0x61 && n <= 0x7A) || n === 32 || n === 10 || n === 9 ||
           (n >= 0x30 && n <= 0x39);
  }).join('').trim();
}

// ── Enterprise system prompts ────────────────────────────────────────────────
var SYSTEM_PROMPT_TO_THAI =
  'You are an enterprise-grade AI translation engine. [Chat Context] is [Group].\n\n' +
  'MODE: GROUP_CHAT_TRANSLATOR\n' +
  '- PURE TRANSLATION ONLY. You are a proxy translator between third parties.\n' +
  '- You are NEVER the recipient. Translate questions/requests as-is. NEVER answer them.\n' +
  '- NO FILLERS: No intro or closing remarks. Output ONLY the translated text.\n\n' +
  'RULES:\n' +
  '1. FORMAL REGISTER (ALWAYS): Always use formal polite Thai. End every sentence with ครับ. Use respectful vocabulary. Apply regardless of input formality.\n' +
  '2. COMPLETENESS: Translate EVERY word. Never omit, skip, or summarize.\n' +
  '3. PROPER NOUNS: Korean names -> English transliteration (e.g. \ucd5c\uc120\ubbfc -> Choi Sun-min). Brand names stay in English.\n' +
  '4. INTENT: Capture cultural nuances and idioms accurately.\n' +
  '5. CURRENCY: Keep amounts and currency units exactly as written. No conversion.\n' +
  '6. OUTPUT: Thai script only. Unknown proper nouns in English. No romanization.\n\n' +
  'GLOSSARY: \ubcc0\ud638\uc0ac=\u0e17\u0e19\u0e32\u0e22\u0e04\u0e27\u0e32\u0e21(NOT \u0e1c\u0e39\u0e49\u0e1e\u0e34\u0e1e\u0e32\u0e01\u0e29\u0e32), \ud310\uc0ac=\u0e1c\u0e39\u0e49\u0e1e\u0e34\u0e1e\u0e32\u0e01\u0e29\u0e32, \ubc95\uc6d0=\u0e28\u0e32\u0e25, \ube44\uc790=\u0e27\u0e35\u0e0b\u0e48\u0e32, \ud68c\uc0ac=\u0e1a\u0e23\u0e34\u0e29\u0e31\u0e17, \uace0\uac1d=\u0e25\u0e39\u0e01\u0e04\u0e49\u0e32, \uc218\uc218\ub8cc=\u0e04\u0e48\u0e32\u0e18\u0e23\u0e23\u0e21\u0e40\u0e19\u0e35\u0e22\u0e21, \ucde8\uc18c=\u0e22\u0e01\u0e40\u0e25\u0e34\u0e01, 요즘=ช่วงนี้/เร็วๆนี้(NOT วันนี้), 오늘=วันนี้, 내일=พรุ่งนี้(NOT 모레), 모레=มะรืน, 나중에=ในภายหลัง/ทีหลัง, 최근=เร็วๆนี้, 법인=นิติบุคคล, 법인회사=บริษัทจำกัด, 계약=สัญญา, 서류=เอกสาร, 신청=ยื่นคำร้อง, 확인=ยืนยัน/ตรวจสอบ, 진행=ดำเนินการ, 처리=จัดการ, 담당자=ผู้รับผิดชอบ, 입금=โอนเงิน/ชำระเงิน, 계좌=บัญชีธนาคาร, 영수증=ใบเสร็จ, 견적=ใบเสนอราคา, 계약금=เงินมัดจำ, 잔금=ยอดคงเหลือ, 세금=ภาษี, 허가=ใบอนุญาต, 등록=จดทะเบียน, 여권=หนังสือเดินทาง, 체류=พำนัก/อยู่อาศัย, 연장=ต่ออายุ, 만료=หมดอายุ, 출입국=ตรวจคนเข้าเมือง, 외국인=ชาวต่างชาติ, 혹시=ถ้าเผื่อ, 가능=สามารถทำได้, 불가능=ไม่สามารถทำได้, 문의=สอบถาม, 이번 주=สัปดาห์นี้, 다음 주=สัปดาห์หน้า, 지난주=สัปดาห์ที่แล้ว, 아직=ยัง, 이미=เรียบร้อยแล้ว, 조사=ตรวจสอบ/สอบสวน, 소유=ถือหุ้น/เจ้าของ, 소송=ฟ้องร้อง/คดีความ, 고소=แจ้งความ/ฟ้องร้อง, 합의=ยอมความ/ตกลง, 계약서=หนังสือสัญญา, 위임장=หนังสือมอบอำนาจ, 공증=รับรองเอกสาร, 부동산=อสังหาริมทรัพย์, 국적=สัญชาติ, 영주권=ถิ่นที่อยู่ถาวร, 노동허가증=ใบอนุญาตทำงาน, 임시=ชั่วคราว, 영구=ถาวร, 승인=อนุมัติ, 반려=ปฏิเสธ/คืน, 제출=ยื่น/ส่ง, 변경=เปลี่ยนแปลง, 추가=เพิ่มเติม, 수정=แก้ไข, 검토=พิจารณา/ตรวจทาน, 상담=ปรึกษา, 일정=กำหนดการ, 마감=กำหนดส่ง, 미팅=ประชุม/นัดหมาย, 예약=จอง/นัดหมาย, 지금=ตอนนี้/เดี๋ยวนี้, 곧=ในไม่ช้า, 빨리=รีบ/เร็วๆ, 잠시=สักครู่, 아무래도=ดูเหมือน, 혹은=หรือ, 사실=จริงๆแล้ว, 부탁드립니다=ขอความกรุณาครับ, 감사합니다=ขอบคุณครับ, 수고하셨습니다=ขอบคุณครับ, 잘 부탁드립니다=ฝากด้วยนะครับ, 각서=บันทึกข้อตกลง, 임대=เช่า/เช่าระยะยาว, 보증금=เงินประกัน, 이따가=เดี๋ยว/อีกสักครู่, 바로=ทันที/เดี๋ยวนี้, 빨리빨리=รีบเลย, 진행 중=กำลังดำเนินการอยู่, 완료=เสร็จสิ้น/เรียบร้อยแล้ว, 처리 완료=จัดการเสร็จแล้ว, 서류 미비=เอกสารไม่ครบ, 서류 완비=เอกสารครบถ้วน, 첨부=แนบมาด้วย, 서명=ลงนาม/เซ็น, 도장=ตราประทับ, 총=รวมทั้งสิ้น, 포함=รวมอยู่ด้วย, 제외=ยกเว้น/ไม่รวม, 부가세=VAT/ภาษีมูลค่าเพิ่ม, 할인=ส่วนลด, 무료=ฟรี/ไม่มีค่าใช้จ่าย, 유료=มีค่าใช้จ่าย, 연락드리겠습니다=จะติดต่อกลับครับ, 알아보겠습니다=จะหาข้อมูลให้ครับ, 확인해드리겠습니다=จะตรวจสอบให้ครับ, 괜찮습니다=ไม่เป็นไร/โอเค, 죄송합니다=ขอโทษครับ, 잠깐만요=รอสักครู่ครับ, 잠시만요=รอสักครู่ครับ, 가능합니다=สามารถทำได้ครับ, 안됩니다=ทำไม่ได้/ไม่ได้ครับ, 언제쯤=ประมาณเมื่อไหร่, 얼마나=นานแค่ไหน/เท่าไหร่, 왜=ทำไม, 아마도=คงจะ/น่าจะ, 영사관=กงสุล, 대사관=สถานทูต, 취업허가=ใบอนุญาตทำงาน\n- สกุลเงิน: บาท=บาท (ไม่ใช่วอน), 원=วอน. ห้ามแปลง/คำนวณอัตราแลกเปลี่ยน. ตัวอย่าง: 200만 바트 → 200 ล้านบาท\n- @mention: คงไว้ตามเดิม ห้ามแปล';

var SYSTEM_PROMPT_TO_KOREAN =
  'You are an enterprise-grade AI translation engine. [Chat Context] is [Group].\n\n' +
  'MODE: GROUP_CHAT_TRANSLATOR\n' +
  '- PURE TRANSLATION ONLY. You are a proxy translator between third parties.\n' +
  '- You are NEVER the recipient. Translate questions/requests as-is. NEVER answer them.\n' +
  '- NO FILLERS: No intro or closing remarks. Output ONLY the translated text.\n\n' +
  'RULES:\n' +
  '1. FORMAL REGISTER (ALWAYS): Always use formal 합쇼체 (endings: -습니다/-입니다/-갠습니다). Use 저희 (NOT 우리) for our company/staff. Never use 반말. Apply to ALL inputs.\n' +
  '2. COMPLETENESS: Translate EVERY word. Never omit, skip, or summarize.\n' +
  '3. PROPER NOUNS: Brand names and English names stay in English letters.\n' +
  '4. INTENT: Capture cultural nuances and idioms accurately.\n' +
  '5. CURRENCY: Keep amounts and currency units exactly as written. No conversion.\n' +
  '6. OUTPUT: Korean Hangul only. Unknown proper nouns in English. NEVER romanize Korean words.\n\n' +
  'GLOSSARY: \u0e17\u0e19\u0e32\u0e22/\u0e17\u0e19\u0e32\u0e22\u0e04\u0e27\u0e32\u0e21=\ubcc0\ud638\uc0ac(NOT \ud310\uc0ac), \u0e1c\u0e39\u0e49\u0e1e\u0e34\u0e1e\u0e32\u0e01\u0e29\u0e32=\ud310\uc0ac, \u0e28\u0e32\u0e25=\ubc95\uc6d0, \u0e27\u0e35\u0e0b\u0e48\u0e32=\ube44\uc790, \u0e1a\u0e23\u0e34\u0e29\u0e31\u0e17=\ud68c\uc0ac, \u0e25\u0e39\u0e01\u0e04\u0e49\u0e32=\uace0\uac1d, \u0e04\u0e48\u0e32\u0e18\u0e23\u0e23\u0e21\u0e40\u0e19\u0e35\u0e22\u0e21=\uc218\uc218\ub8cc, \u0e22\u0e01\u0e40\u0e25\u0e34\u0e01=\ucde8\uc18c, ช่วงนี้/ตอนนี้=요즘, วันนี้=오늘, พรุ่งนี้=내일(NOT 모레), มะรืน=모레, ภายหลัง/ทีหลัง=나중에, เร็วๆนี้=최근, นิติบุคคล=법인, บริษัทจำกัด=법인회사, สัญญา=계약, เอกสาร=서류, ยื่นคำร้อง=신청, ยืนยัน/ตรวจสอบ=확인, ดำเนินการ=진행, จัดการ=처리, ผู้รับผิดชอบ=담당자, โอนเงิน=입금/송금, บัญชีธนาคาร=계좌, ใบเสร็จ=영수증, ใบเสนอราคา=견적, เงินมัดจำ=계약금, ยอดคงเหลือ=잔금, ภาษี=세금, ใบอนุญาต=허가, จดทะเบียน=등록, หนังสือเดินทาง=여권, พำนัก=체류, ต่ออายุ=연장, หมดอายุ=만료, ตรวจคนเข้าเมือง=출입국, ชาวต่างชาติ=외국인, สอบถาม=문의, สัปดาห์นี้=이번 주, สัปดาห์หน้า=다음 주, สัปดาห์ที่แล้ว=지난주, ยัง=아직, เรียบร้อยแล้ว=이미, ตรวจสอบ/สอบสวน=조사, ถือหุ้น/เจ้าของ=소유, ฟ้องร้อง=소송, แจ้งความ=고소, ยอมความ=합의, หนังสือสัญญา=계약서, หนังสือมอบอำนาจ=위임장, รับรองเอกสาร=공증, อสังหาริมทรัพย์=부동산, สัญชาติ=국적, ถิ่นที่อยู่ถาวร=영주권, ใบอนุญาตทำงาน=노동허가증, ชั่วคราว=임시, ถาวร=영구, อนุมัติ=승인, ปฏิเสธ=반려, ยื่น/ส่ง=제출, เปลี่ยนแปลง=변경, เพิ่มเติม=추가, แก้ไข=수정, พิจารณา=검토, ปรึกษา=상담, กำหนดการ=일정, กำหนดส่ง=마감, ประชุม/นัดหมาย=미팅, จอง/นัดหมาย=예약, ตอนนี้=지금, ในไม่ช้า=곧, รีบ=빨리, สักครู่=잠시, จริงๆแล้ว=사실, ขอความกรุณา=부탁드립니다, ขอบคุณ=감사합니다, บันทึกข้อตกลง=각서, เงินประกัน=보증금, เดี๋ยว/อีกสักครู่=이따가/잠시 후, ทันที/เดี๋ยวนี้=바로/즉시, กำลังดำเนินการ/อยู่ระหว่างดำเนินการ=진행 중, เสร็จแล้ว/เรียบร้อย=완료/다 됐습니다, เอกสารไม่ครบ=서류 미비, เอกสารครบ=서류 완비, แนบ/แนบมาด้วย=첨부, ลงนาม/เซ็น=서명, ตราประทับ=도장, รวมทั้งสิ้น=총, รวมอยู่ด้วย=포함, ยกเว้น/ไม่รวม=제외, VAT/ภาษีมูลค่าเพิ่ม=부가세, ส่วนลด=할인, ฟรี=무료, มีค่าใช้จ่าย=유료, จะติดต่อกลับ=연락드리겠습니다, จะหาข้อมูลให้=알아보겠습니다, จะตรวจสอบให้=확인해드리겠습니다, ไม่เป็นไร=괜찮습니다, ขอโทษ=죄송합니다, รอสักครู่=잠시만요/잠깐만요, ทำได้=가능합니다, ทำไม่ได้=안됩니다, ทำไม=왜, ไม่แน่ใจ=잘 모르겠습니다, น่าจะ/คงจะ=아마도, กงสุล=영사관, สถานทูต=대사관\n- 통화: บาท=바트(절대 원으로 번환 금지). 예: 200만 바트(NOT 200만 원)\n- @멘션은 번역하지 않고 원문 그대로 유지';

// ── Gemini fallback (4th layer, activates if GEMINI_API_KEY is set) ──────────
async function geminiTranslate(text, systemPrompt) {
  if (!GEMINI_API_KEY) return null;
    var gCtrl = new AbortController();
      var gTimer = setTimeout(function() { gCtrl.abort(); }, 20000);
  try {
    const res = await axios.post(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=' + GEMINI_API_KEY,
      {
        system_instruction: { parts: [{ text: systemPrompt }] },
        contents: [{ parts: [{ text: text }] }],
        generationConfig: { temperature: 0.1, maxOutputTokens: 1500 },
      },
      { headers: { 'Content-Type': 'application/json' }, signal: gCtrl.signal }
    );
    const result = res.data.candidates[0].content.parts[0].text.trim();
        clearTimeout(gTimer);
    if (isRepetitive(result)) return null;
    console.log('[Translate] used Gemini fallback');
    return result;
  } catch (err) {
    console.error('[Translate] Gemini error:', err.response ? err.response.data : err.message);
        clearTimeout(gTimer);
    return null;
  }
}

// ── Groq models (3 primary + Gemini as 4th) ─────────────────────────────────
var GROQ_MODELS = ['openai/gpt-oss-20b', 'openai/gpt-oss-120b'];

async function aiTranslate(text, systemPrompt) {
  // Try each Groq model
  for (var i = 0; i < GROQ_MODELS.length; i++) {
    var model = GROQ_MODELS[i];
        var aCtrl = new AbortController();
            var aTimer = setTimeout(function() { aCtrl.abort(); }, 12000);
    try {
      var res = await axios.post(
        'https://api.groq.com/openai/v1/chat/completions',
        {
          model: model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user',   content: text },
          ],
          temperature: 0.1,
          max_tokens: 1500,
        },
        { headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + GROQ_API_KEY }, signal: aCtrl.signal }
      );
      var result = res.data.choices[0].message.content.trim();
          clearTimeout(aTimer);


      if (isRepetitive(result)) {
        console.warn('[Translate] repetition on ' + model + ', trying next...');
        continue;
      }
      if (i > 0) console.log('[Translate] used fallback model:', model);
          clearTimeout(aTimer);
      return result;
    } catch (err) {
          clearTimeout(aTimer);
      var code = err.response && err.response.data && err.response.data.error && err.response.data.error.code;
      var isLimit = code === 'rate_limit_exceeded' || (err.response && err.response.status === 429);
      if ((isLimit || err.code === 'ECONNABORTED' || err.code === 'ERR_CANCELED' || aCtrl.signal.aborted) && i < GROQ_MODELS.length - 1) {
        console.warn('[Translate] ' + (isLimit ? 'rate limit' : 'timeout') + ' on ' + model + ', trying next...');
        continue;
      }
      console.error('[Translate] Groq error on ' + model + ':', err.response ? err.response.data : err.message);
    }
  }
  // 4th fallback: Gemini
  console.warn('[Translate] all Groq models failed, trying Gemini...');
  return await geminiTranslate(text, systemPrompt);
}

// ── translateAll: returns { kr, th } or null ─────────────────────────────────
async function translateAll(text) {
  var cleanText = text.replace(/https?:\/\/[^\s]+/g, '').trim();
  if (!cleanText) return null;
  text = cleanText;  // Skip if already bilingual (Thai+Korean both present)
    if (THAI_REGEX.test(text) && KOREAN_REGEX.test(text)) return null;

  if (THAI_REGEX.test(text)) {
    console.log('[TR] th->kr');
    var raw = await aiTranslate(text, SYSTEM_PROMPT_TO_KOREAN + '\n\nTranslate the following Thai text to Korean:');
    if (!raw) return null;
    var kr = cleanKorean(raw);
    if (!kr || !KOREAN_REGEX.test(kr)) return null;
    console.log('[TR] th->kr ok');
    return { kr: kr, th: null };
  }

  if (KOREAN_REGEX.test(text)) {
    console.log('[TR] kr->th');
    var raw = await aiTranslate(text, SYSTEM_PROMPT_TO_THAI + '\n\nTranslate the following Korean text to Thai:');
    if (!raw) return null;
    var th = cleanThai(raw);
    if (!th || !THAI_REGEX.test(th)) return null;
    console.log('[TR] kr->th ok');
    return { kr: null, th: th };
  }

  if (ENGLISH_REGEX.test(text) && !THAI_REGEX.test(text) && !KOREAN_REGEX.test(text)) {
    console.log('[TR] en->th');
    var raw = await aiTranslate(text, SYSTEM_PROMPT_TO_THAI + '\n\nTranslate the following English text to Thai:');
    if (!raw) return null;
    var th = cleanThai(raw);
    if (!th || !THAI_REGEX.test(th)) return null;
    console.log('[TR] en->th ok');
    return { kr: null, th: th };
  }

  return null;
}

async function translate(text) {
  var result = await translateAll(text);
  if (!result) return null;
  return result.kr || result.th || null;
}

async function replyMessages(replyToken, messages) {
  const isDummy = !replyToken || /^0+$/.test(replyToken);
  console.log('[LINE] tok:', replyToken ? replyToken.slice(0, 15) : 'NULL', 'isDummy:', isDummy);
  if (isDummy) throw new Error('dummy reply token');
  try {
    await axios.post(
      LINE_API_BASE + '/message/reply',
      { replyToken: replyToken, messages: messages },
      { headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + ACCESS_TOKEN } }
    );
    console.log('[LINE] Reply ok');
  } catch (err) {
    console.error('[LINE] Reply failed (HTTP', err.response ? err.response.status : '?', '):', err.response ? err.response.data : err.message);
    throw err;
  }
}

async function checkBotInfo() {
  try {
    const res = await axios.get(LINE_API_BASE + '/info', {
      headers: { Authorization: 'Bearer ' + ACCESS_TOKEN }
    });
    return { ok: true, data: res.data, gemini: !!GEMINI_API_KEY };
  } catch (err) {
    return { ok: false, status: err.response ? err.response.status : null, error: err.response ? err.response.data : err.message };
  }
}

async function replyOOO(replyToken) {
  await replyMessages(replyToken, [{ type: 'text', text: OOO_MESSAGE }]);
  console.log('[LINE] OOO reply sent.');
}

async function getSenderName(event) {
  try {
    const { userId, groupId, roomId } = event.source;
    let url;
    if (groupId)     url = LINE_API_BASE + '/group/' + groupId + '/member/' + userId;
    else if (roomId) url = LINE_API_BASE + '/room/'  + roomId  + '/member/' + userId;
    else             url = LINE_API_BASE + '/profile/' + userId;
    const res = await axios.get(url, { headers: { Authorization: 'Bearer ' + ACCESS_TOKEN } });
    return res.data.displayName || userId;
  } catch (e) {
    return event.source.userId || 'Unknown';
  }
}

module.exports = {
  verifySignature: verifySignature,
  translate: translate,
  translateToKorean: translate,
  translateAll: translateAll,
  replyMessages: replyMessages,
  replyOOO: replyOOO,
  getSenderName: getSenderName,
  checkBotInfo: checkBotInfo,
  OOO_MESSAGE: OOO_MESSAGE,
};
