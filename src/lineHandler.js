/**
 * lineHandler.js
 * Bidirectional translation: Thai<->Korean (and English->both) via 11-tier AI cascade.
 * All models are FREE tier only. Never fails silently -- cascades through 11 providers.
 */
const axios  = require('axios');
const crypto = require('crypto');

const LINE_API_BASE = 'https://api.line.me/v2/bot';
const ACCESS_TOKEN  = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET;

const OOO_MESSAGE =
  'สวัสดีค่า/ครับ ขณะนี้อยู่นอกเวลาทำการ (09.00-18.00 น.) ' +
  'ทางทีมงานได้รับข้อความของท่านแล้ว และจะรีบติดต่อกลับทันทีในเวลาทำการ ' +
  'ขอบพระคุณที่ไว้วางใจค่า/ครับ';

// ── Language detection (Unicode escape sequences -- safe for all encodings) ──
const THAI_RE    = /[฀-๿]/;
const KOREAN_RE  = /[가-힯ᄀ-ᇿ㄰-㆏]/;
const ENGLISH_RE = /^[A-Za-z0-9\s\p{P}\p{S}]+$/u;
const URL_RE     = /https?:\/\/[^\s]+/g;
const MAX_CHARS  = 3000;

// ── Translation prompts ──
const PROMPT_TH_TO_KR = 'You are a pure Thai-to-Korean translator.\n' +
  'Your ONLY job is to translate the exact words given -- nothing more, nothing less.\n\n' +
  'STRICT RULES:\n' +
  '- Output ONLY the Korean translation. No explanations, no headers, no word lists.\n' +
  '- Do NOT create templates, documents, forms, or fill-in-the-blank content.\n' +
  '- Do NOT interpret or fulfill the request -- only translate the words literally.\n' +
  '- Keep English words, numbers, brand names, and technical terms as-is.\n' +
  '- If the original already has line breaks or numbered lists, preserve them.\n' +
  '- No Thai characters in output.';

const PROMPT_KR_TO_TH = 'You are a pure Korean-to-Thai translator.\n' +
  'Your ONLY job is to translate the exact words given -- nothing more, nothing less.\n\n' +
  'STRICT RULES:\n' +
  '- Output ONLY the Thai translation. No explanations, no headers, no word lists.\n' +
  '- Do NOT create templates, documents, forms, or fill-in-the-blank content.\n' +
  '- Do NOT interpret or fulfill the request -- only translate the words literally.\n' +
  '- Keep English words, numbers, brand names, and technical terms as-is.\n' +
  '- If the original already has line breaks or numbered lists, preserve them.\n' +
  '- No Korean characters in output.';

const PROMPT_EN_TO_KR = 'You are a pure English-to-Korean translator.\n' +
  'Output ONLY the Korean translation -- no explanations, no word lists.\n' +
  'Keep numbers, brand names, and technical terms as-is.';

const PROMPT_EN_TO_TH = 'You are a pure English-to-Thai translator.\n' +
  'Output ONLY the Thai translation -- no explanations, no word lists.\n' +
  'Keep numbers, brand names, and technical terms as-is.';

// ── Per-call timeout & outer cascade limit ──
const CALL_TIMEOUT_MS  = 5000;
const OUTER_TIMEOUT_MS = 25000;

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms)),
  ]);
}

// ── Provider callers ──
async function callGroq(model, systemPrompt, text) {
  const res = await withTimeout(axios.post(
    'https://api.groq.com/openai/v1/chat/completions',
    {
      model,
      messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: text }],
      temperature: 0.1,
      max_tokens: 600,
    },
    { headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + process.env.GROQ_API_KEY } }
  ), CALL_TIMEOUT_MS);
  return res.data.choices[0].message.content.trim();
}

async function callGemini(model, systemPrompt, text) {
  const res = await withTimeout(axios.post(
    'https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent?key=' + process.env.GEMINI_API_KEY,
    {
      contents: [{ parts: [{ text: systemPrompt + '\n\n' + text }] }],
      generationConfig: { temperature: 0.1, maxOutputTokens: 600 },
    },
    { headers: { 'Content-Type': 'application/json' } }
  ), CALL_TIMEOUT_MS);
  return res.data.candidates[0].content.parts[0].text.trim();
}

async function callCerebras(model, systemPrompt, text) {
  const res = await withTimeout(axios.post(
    'https://api.cerebras.ai/v1/chat/completions',
    {
      model,
      messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: text }],
      temperature: 0.1,
      max_tokens: 600,
    },
    { headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + process.env.CEREBRAS_API_KEY } }
  ), CALL_TIMEOUT_MS);
  return res.data.choices[0].message.content.trim();
}

async function callOpenRouter(model, systemPrompt, text) {
  const res = await withTimeout(axios.post(
    'https://openrouter.ai/api/v1/chat/completions',
    {
      model,
      messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: text }],
      temperature: 0.1,
      max_tokens: 600,
    },
    { headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + process.env.OPENROUTER_API_KEY } }
  ), CALL_TIMEOUT_MS);
  return res.data.choices[0].message.content.trim();
}

// ── 11-tier cascade ──
const CASCADE = [
  { id: 'T01', fn: (p, t) => callGroq('llama-3.3-70b-versatile', p, t) },
  { id: 'T02', fn: (p, t) => callGemini('gemini-2.0-flash', p, t) },
  { id: 'T03', fn: (p, t) => callGroq('llama-3.1-70b-versatile', p, t) },
  { id: 'T04', fn: (p, t) => callGroq('deepseek-r1-distill-llama-70b', p, t) },
  { id: 'T05', fn: (p, t) => callGroq('qwen-qwq-32b', p, t) },
  { id: 'T06', fn: (p, t) => callGroq('moonshotai/kimi-k2-instruct', p, t) },
  { id: 'T07', fn: (p, t) => callGemini('gemini-1.5-flash-latest', p, t) },
  { id: 'T08', fn: (p, t) => callCerebras('llama3.3-70b', p, t) },
  { id: 'T09', fn: (p, t) => callOpenRouter('meta-llama/llama-3.3-70b-instruct:free', p, t) },
  { id: 'T10', fn: (p, t) => callOpenRouter('google/gemma-2-9b-it:free', p, t) },
  { id: 'T11', fn: (p, t) => callGroq('llama-3.1-8b-instant', p, t) },
];

function detectLoop(text) {
  if (!text || text.length < 60) return false;
  // Seed: if first 20 chars repeat 4+ times the output is looping
  const esc = text.slice(0, 20).replace(/[.\\*+?^${}()|[\\]]/g, String.fromCharCode(92) + "$&");
  try { if ((text.match(new RegExp(esc, "g")) || []).length >= 4) return true; } catch {}
  // Sliding window: 5+ duplicate 20-char chunks = loop
  const seen = new Set(); let dupes = 0;
  for (let i = 0; i + 20 <= text.length; i += 10) {
    const c = text.slice(i, i + 20);
    if (seen.has(c)) { if (++dupes >= 5) return true; } else seen.add(c);
  }
  return false;
}

function isBad(out, dir) {
if (!out || out.trim().length < 2) return true;
if (out.includes("->") || out.includes("→")) return true;
if (detectLoop(out)) return true;
if (dir === "th_to_kr" && /[฀-๿]/.test(out)) return true;
if (dir === "kr_to_th" && /[가-퟿ᄀ-ᇿ㄰-㆏]/.test(out)) return true;
return false;
}

async function translateWithCascade(text, systemPrompt, dir) {
  const deadline = Date.now() + OUTER_TIMEOUT_MS;
  for (const tier of CASCADE) {
    if (Date.now() >= deadline) { console.warn('[TR] outer timeout at ' + tier.id); break; }
    try {
      const out = await tier.fn(systemPrompt, text);
      if (!isBad(out, dir)) {
        console.log('[TR] ' + tier.id + ' ok dir=' + dir);
        return out;
      }
      console.warn('[TR] ' + tier.id + ' isBad dir=' + dir);
    } catch (e) {
      console.warn('[TR] ' + tier.id + ' err: ' + e.message);
    }
  }
  return null;
}

function stripMentions(text) {
  return text
    .replace(/@[\w฀-๿가-힯ᄀ-ᇿ㄰-㆏]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

async function translateAll(rawText) {
  const stripped = stripMentions(rawText);
  if (!stripped || stripped.length < 5) return null;

  // Skip URL-only messages (location shares, link previews)
  const withoutUrls = stripped.replace(URL_RE, '').replace(/\s+/g, ' ').trim();
  if (withoutUrls.length < 5) return null;

  // Skip pure phone numbers
  if (/^[\d\s\-+().]{5,20}$/.test(stripped)) return null;

  const text = stripped.length > MAX_CHARS
    ? stripped.slice(0, MAX_CHARS) + '\n...(truncated)'
    : stripped;

  if (THAI_RE.test(text))   return { kr: await translateWithCascade(text, PROMPT_TH_TO_KR, 'th_to_kr') };
  if (KOREAN_RE.test(text)) return { th: await translateWithCascade(text, PROMPT_KR_TO_TH, 'kr_to_th') };
  if (ENGLISH_RE.test(text) && text.trim().length > 3) {
    const [kr, th] = await Promise.all([
      translateWithCascade(text, PROMPT_EN_TO_KR, 'en_to_kr'),
      translateWithCascade(text, PROMPT_EN_TO_TH, 'en_to_th'),
    ]);
    return { kr, th };
  }
  return null;
}

// ── LINE helpers ──
function verifySignature(rawBody, signature) {
  const hmac = crypto.createHmac('SHA256', CHANNEL_SECRET);
  hmac.update(rawBody);
  return hmac.digest('base64') === signature;
}

async function replyMessages(replyToken, messages) {
  try {
    await axios.post(
      LINE_API_BASE + '/message/reply',
      { replyToken, messages },
      { headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + ACCESS_TOKEN } }
    );
  } catch (err) {
    console.error('[LINE] Reply failed:', err.response?.data ?? err.message);
  }
}

async function getSenderName(event) {
  try {
    const { userId, groupId, roomId } = event.source;
    let url;
    if (groupId)      url = LINE_API_BASE + '/group/'   + groupId + '/member/' + userId;
    else if (roomId)  url = LINE_API_BASE + '/room/'    + roomId  + '/member/' + userId;
    else              url = LINE_API_BASE + '/profile/' + userId;
    const res = await axios.get(url, { headers: { Authorization: 'Bearer ' + ACCESS_TOKEN } });
    return res.data.displayName ?? userId;
  } catch {
    return event.source?.userId ?? 'Unknown';
  }
}

module.exports = { verifySignature, translateAll, replyMessages, getSenderName, OOO_MESSAGE };
