/**
 * lineHandler.js — อูจิน (우진) Translation Engine
 *
 * ╔══════════════════════════════════════════════════════════════╗
 *  11-TIER FREE TRANSLATION CASCADE — ฟรีทุกชั้น ไม่มีบั๊ค
 * ╚══════════════════════════════════════════════════════════════╝
 *
 *  T01: Groq llama-3.3-70b      FREE  6K TPM
 *  T02: Gemini 1.5 Flash        FREE  1M TPM
 *  T03: Gemini 2.0 Flash        FREE  4M TPM
 *  T04: Cerebras llama-3.3-70b  FREE 60K TPM
 *  T05: OR llama-3.3-70b:free   FREE  20 RPM  200 RPD
 *  T06: Groq mixtral-8x7b       FREE  5K TPM
 *  T07: Groq gemma2-9b          FREE 14K TPM
 *  T08: OR gemma-2-9b:free      FREE  20 RPM  200 RPD
 *  T09: OR mistral-7b:free      FREE  20 RPM  200 RPD
 *  T10: OR phi-3-mini:free      FREE  20 RPM  200 RPD
 *  T11: Groq llama-3.1-8b       FREE  6K TPM  ← final safety net
 *
 *  4 บริษัท | 11 โมเดล | quota pool แยกกันทุกชั้น
 */
require('dotenv').config();
const crypto = require('crypto');
const axios  = require('axios');

const CHANNEL_SECRET       = process.env.LINE_CHANNEL_SECRET;
const CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const GROQ_API_KEY         = process.env.GROQ_API_KEY;
const GEMINI_API_KEY       = process.env.GEMINI_API_KEY;
const CEREBRAS_API_KEY     = process.env.CEREBRAS_API_KEY;
const OPENROUTER_API_KEY   = process.env.OPENROUTER_API_KEY;

const UJIN_NAME = 'อูจิน (우진)';
const COMPANY   = 'Wisdom International';

function verifySignature(body, signature) {
  return crypto.createHmac('SHA256', CHANNEL_SECRET).update(body).digest('base64') === signature;
}

const PROMPT_TH_TO_KR = `당신은 전문 태국어-한국어 번역가입니다.
아래 태국어 메시지를 자연스러운 한국어 문장으로 번역하세요.
규칙: 번역문만 출력 | "단어→번역" 형식 금지 | 태국어 문자 출력 금지 | 구어체 유지 | 한 문단으로`;

const PROMPT_KR_TO_TH = `คุณคือนักแปลเกาหลี-ไทยมืออาชีพ แปลข้อความเกาหลีเป็นไทยธรรมชาติ
กฎ: ส่งออกเฉพาะข้อความแปล | ห้ามรูปแบบ "คำ→แปล" | ห้ามอักษรเกาหลีในผลลัพธ์ | รักษาน้ำเสียง | ย่อหน้าเดียว`;

const PROMPT_EN_TO_KR = `Professional English to Korean translator.
Rules: Korean translation only | No word lists | No English in output | Natural tone | Single paragraph.`;

const PROMPT_EN_TO_TH = `Professional English to Thai translator.
Rules: Thai translation only | No word lists | No English in output | Natural tone | Single paragraph.`;

function isBad(out, dir) {
  if (!out || out.trim().length < 2) return true;
  if (out.includes('->') || out.includes('→')) return true;
  if (dir==='th_to_kr' && /[฀-๿]/.test(out)) return true;
  if (dir==='kr_to_th' && /[가-힯]/.test(out)) return true;
  return false;
}

function isQuota(e){ const s=e.response?.status; return s===429||s===413||s===503; }

const groq = (sys,usr,model) =>
  axios.post('https://api.groq.com/openai/v1/chat/completions',
    {model,messages:[{role:'system',content:sys},{role:'user',content:usr}],temperature:0.1,max_tokens:1500},
    {headers:{Authorization:`Bearer ${GROQ_API_KEY}`},timeout:20000}
  ).then(r=>r.data.choices[0].message.content.trim());

const gemini = (sys,usr,model) => {
  if(!GEMINI_API_KEY) return Promise.reject(new Error('No GEMINI_API_KEY'));
  return axios.post(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`,
    {contents:[{parts:[{text:sys+'\n\n'+usr}]}],generationConfig:{temperature:0.1,maxOutputTokens:1500}},
    {timeout:20000}
  ).then(r=>r.data.candidates[0].content.parts[0].text.trim());
};

const cerebras = (sys,usr) => {
  if(!CEREBRAS_API_KEY) return Promise.reject(new Error('No CEREBRAS_API_KEY'));
  return axios.post('https://api.cerebras.ai/v1/chat/completions',
    {model:'llama-3.3-70b',messages:[{role:'system',content:sys},{role:'user',content:usr}],temperature:0.1,max_tokens:1500},
    {headers:{Authorization:`Bearer ${CEREBRAS_API_KEY}`},timeout:20000}
  ).then(r=>r.data.choices[0].message.content.trim());
};

const openrouter = (sys,usr,model) => {
  if(!OPENROUTER_API_KEY) return Promise.reject(new Error('No OPENROUTER_API_KEY'));
  return axios.post('https://openrouter.ai/api/v1/chat/completions',
    {model,messages:[{role:'system',content:sys},{role:'user',content:usr}],temperature:0.1,max_tokens:1500},
    {headers:{Authorization:`Bearer ${OPENROUTER_API_KEY}`,
      'HTTP-Referer':'https://wisdom-ujin.onrender.com','X-Title':'Wisdom Ujin'},timeout:20000}
  ).then(r=>r.data.choices[0].message.content.trim());
};

async function translateWithCascade(text, sys, dir) {
  const tiers = [
    {n:'T01:Groq-70b',      f:()=>groq(sys,text,'llama-3.3-70b-versatile')},
    {n:'T02:Gemini-1.5',    f:()=>gemini(sys,text,'gemini-1.5-flash')},
    {n:'T03:Gemini-2.0',    f:()=>gemini(sys,text,'gemini-2.0-flash')},
    {n:'T04:Cerebras-70b',  f:()=>cerebras(sys,text)},
    {n:'T05:OR-llama-70b',  f:()=>openrouter(sys,text,'meta-llama/llama-3.3-70b-instruct:free')},
    {n:'T06:Groq-Mixtral',  f:()=>groq(sys,text,'mixtral-8x7b-32768')},
    {n:'T07:Groq-Gemma2',   f:()=>groq(sys,text,'gemma2-9b-it')},
    {n:'T08:OR-Gemma2',     f:()=>openrouter(sys,text,'google/gemma-2-9b-it:free')},
    {n:'T09:OR-Mistral-7b', f:()=>openrouter(sys,text,'mistralai/mistral-7b-instruct:free')},
    {n:'T10:OR-Phi3-mini',  f:()=>openrouter(sys,text,'microsoft/phi-3-mini-128k-instruct:free')},
    {n:'T11:Groq-8b',       f:()=>groq(sys,text,'llama-3.1-8b-instant')},
  ];
  for (const t of tiers) {
    try {
      const out = await t.f();
      if (!isBad(out,dir)) { console.log('[TR] ok '+t.n); return out; }
      console.log('[TR] bad '+t.n);
    } catch(e) {
      console.log('[TR] err '+t.n+' '+e.message?.slice(0,40));
    }
  }
  throw new Error('All 11 translation tiers failed');
}

const THAI_RE    = /[฀-๿]/;
const KOREAN_RE  = /[가-힯ᄀ-ᇿ㄰-㆏]/;
const ENGLISH_RE = /^[A-Za-z0-9sp{P}p{S}]+$/u;
const MAX_CHARS  = 3000;

async function translateAll(rawText) {
  const text = rawText.length > MAX_CHARS
    ? rawText.slice(0, MAX_CHARS) + '\n...(ข้อความยาวเกิน ระบบแปลเฉพาะส่วนแรก)'
    : rawText;
  if (THAI_RE.test(text))    return { kr: await translateWithCascade(text, PROMPT_TH_TO_KR, 'th_to_kr') };
  if (KOREAN_RE.test(text))  return { th: await translateWithCascade(text, PROMPT_KR_TO_TH, 'kr_to_th') };
  if (ENGLISH_RE.test(text) && text.trim().length > 1) {
    const [kr,th] = await Promise.all([
      translateWithCascade(text, PROMPT_EN_TO_KR, 'en_to_kr'),
      translateWithCascade(text, PROMPT_EN_TO_TH, 'en_to_th'),
    ]);
    return { kr, th };
  }
  return null;
}

async function replyMessages(replyToken, messages) {
  if (!replyToken || !messages?.length) return;
  await axios.post('https://api.line.me/v2/bot/message/reply',
    {replyToken, messages},
    {headers:{Authorization:`Bearer ${CHANNEL_ACCESS_TOKEN}`,'Content-Type':'application/json'}});
}

async function getSenderName(event) {
  try {
    const uid=event.source?.userId, gid=event.source?.groupId;
    if(!uid) return 'ลูกค้า';
    const url=gid?`https://api.line.me/v2/bot/group/${gid}/member/${uid}`:`https://api.line.me/v2/bot/profile/${uid}`;
    const r=await axios.get(url,{headers:{Authorization:`Bearer ${CHANNEL_ACCESS_TOKEN}`}});
    return r.data.displayName??'ลูกค้า';
  } catch{ return 'ลูกค้า'; }
}

async function translate(text){ const r=await translateAll(text); return r?.kr??null; }

module.exports = { verifySignature, translate, translateAll, translateToKorean:translate, replyMessages, getSenderName, UJIN_NAME, COMPANY };
