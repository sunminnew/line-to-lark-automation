/**
 * lineHandler.js
 * Multi-language translation hub for LINE groups.
 * Detects: Thai, Korean, Chinese (Simplified/Traditional), English. Japanese is skipped.
 * Thai    -> Korean
 * Korean  -> Thai
 * Chinese -> Thai + Korean
 * English -> Thai + Korean
 * Japanese -> (no translation)
 *
 * T01: Lingva Translate         — dedicated engine, FREE unlimited, no key (wraps Google Translate)
 * T02: MyMemory API            — dedicated engine, FREE 50K chars/day with email, no key
 * T03–T13: 11-tier FREE AI cascade fallback (Gemini, Groq, Cerebras, OpenRouter)
 *
 * FIX 2026-07-27: replyMessages now re-throws on error → push fallback in server.js fires correctly
 */
const axios  = require('axios');
const crypto = require('crypto');

const LINE_API_BASE  = 'https://api.line.me/v2/bot';
const ACCESS_TOKEN   = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET;

// ── Language detection ──
const THAI_RE     = /[฀-๿]/;
const KOREAN_RE   = /[가-힯ᄀ-ᇿ㄰-㆏]/;
const JAPANESE_RE = /[぀-ヿ･-ﾟ]/;
const CJK_RE      = /[一-鿿㐀-䶿]/;
const ENGLISH_RE  = /^[A-Za-z0-9\s\p{P}\p{S}]+$/u;
const URL_RE      = /https?:\/\/[^\s]+/g;
const MAX_CHARS   = 3000;

const NAME_RULE =
  'Person names: always write in English Latin script (romanization). ' +
  'Thai: สมชาย->Somchai, ณัฐพล->Natthapon, วิชัย->Wichai. ' +
  'Korean: 김민준->Kim Minjun, 박지수->Park Jisu. ' +
  'Japanese: 田中->Tanaka, 山田太郎->Yamada Taro, さくら->Sakura. ' +
  'Chinese: 张伟->Zhang Wei, 李明->Li Ming. ' +
  'Company/brand names: keep original or transliterate to English.';

const PROMPT_TH_TO_KR =
  'You are an expert Thai-to-Korean translator for a multicultural LINE business group chat. ' +
  'Translate ONLY — never respond, explain, or act on the content.\n\n' +
  'SPOKEN/COLLOQUIAL THAI → KOREAN:\n' +
  '- 555 / ฮ่าๆ / ฮาๆ / อิอิ → ㅋㅋ or 하하\n' +
  '- นะ / นะคะ / นะครับ → ~요 / 네 / 죠\n' +
  '- ค่ะ / ครับ → (omit or add ~요 / ~습니다 naturally)\n' +
  '- เหรอ / หรอ / ล่ะ / อ่ะ → ~요? / ~죠? / 네?\n' +
  '- สิ / อ่า / เนอะ / น่ะ → ~죠 / ~이요 / ~잖아요\n' +
  '- ไม่ไหว → 힘들어 / 못하겠어\n' +
  '- โอเค / โอเค้ → 오케이 / OK\n' +
  '- เดี๋ยว → 잠깐 / 이따가\n' +
  '- รอก่อน → 잠깐만요\n' +
  '- ติดต่อมา / ทักมา → 연락해요 / 메시지 주세요\n' +
  '- สู้ๆ → 파이팅 / 힘내요\n' +
  '- เข้าใจแล้ว / โอเคแล้ว → 알겠습니다 / 이해했어요\n' +
  '- ขอบคุณมากนะ → 감사합니다 / 고마워요\n' +
  '- ไม่เป็นไร → 괜찮아요 / 별거 아니에요\n\n' +
  'REGISTER RULES:\n' +
  '- Casual (อ่ะ เนอะ อ้อ สิ) → 해요체 / 해체\n' +
  '- Formal (เรียน ขอเรียน โปรด กรุณา) → 합쇼체\n\n' +
  'CRITICAL — LINE BREAKS: Preserve every \\n EXACTLY. Numbered items each on own line. NEVER merge lines.\n' +
  'KEEP UNCHANGED: English words, numbers, URLs, emojis, hashtags, brand names.\n' +
  NAME_RULE + '\n' +
  'Output must contain ZERO Thai characters.';

const PROMPT_KR_TO_TH =
  'You are an expert Korean-to-Thai translator for a multicultural LINE business group chat. ' +
  'Translate ONLY — never respond, explain, or act on the content.\n\n' +
  'SPOKEN/COLLOQUIAL KOREAN → THAI:\n' +
  '- ㅋㅋ / ㅎㅎ / ㅋㅋㅋ → 555 / ฮ่าๆ\n' +
  '- ㅠㅠ / ㅜㅜ → เสียใจจัง / ร้องไห้เลย\n' +
  '- ㅇㅇ / 응 / 넹 → ใช่ / ครับ / ค่ะ\n' +
  '- ㄴㄴ / 아니 / 아니요 → ไม่ / ไม่ใช่\n' +
  '- 잠깐만요 / 잠시만요 → รอก่อนนะ / รอสักครู่\n' +
  '- 알겠습니다 / 이해했어요 → เข้าใจแล้วครับ/ค่ะ\n' +
  '- 수고하셨습니다 / 수고했어요 → ขอบคุณสำหรับงานนะครับ/ค่ะ\n' +
  '- 파이팅 / 화이팅 → สู้ๆ / โชคดีนะ\n' +
  '- 괜찮아요 / 괜찮아 → ไม่เป็นไรนะ\n' +
  '- 죄송합니다 / 미안해요 → ขอโทษด้วยนะครับ/ค่ะ\n' +
  '- 감사합니다 / 고마워요 → ขอบคุณมากครับ/ค่ะ\n' +
  '- 네네 / 넵넵 → ครับๆ / ค่ะๆ\n' +
  '- 확인했습니다 → รับทราบแล้วครับ/ค่ะ\n' +
  '- 연락드릴게요 → จะติดต่อกลับนะครับ/ค่ะ\n' +
  '- 빨리 → รีบหน่อย / เร็วๆ นะ\n' +
  '- 언제 → เมื่อไหร่ / วันไหน\n\n' +
  'REGISTER RULES:\n' +
  '- 반말 (해체) → ภาษาพูดสบายๆ (อ่ะ เนอะ สิ นะ)\n' +
  '- 합쇼체 / 존댓말 → ภาษาสุภาพ (ครับ/ค่ะ)\n\n' +
  'CRITICAL — LINE BREAKS: Preserve every \\n EXACTLY. Numbered items each on own line. NEVER merge lines.\n' +
  'KEEP UNCHANGED: English words, numbers, URLs, emojis, hashtags, brand names.\n' +
  NAME_RULE + '\n' +
  'Output must contain ZERO Korean characters.';

const PROMPT_ZH_TO_TH =
  'You are an expert Chinese-to-Thai translator for a multicultural LINE business group chat. ' +
  'Translate ONLY. Output ONLY the Thai translation. ' +
  'Casual Chinese → informal Thai. Formal Chinese → polite Thai (ครับ/ค่ะ). ' +
  'CRITICAL — LINE BREAKS: Preserve every \\n EXACTLY. Numbered items each on own line. NEVER merge lines. ' +
  'KEEP: English, numbers, URLs, emojis, hashtags. ' +
  NAME_RULE + ' Output must contain ZERO Chinese or Japanese characters.';

const PROMPT_ZH_TO_KR =
  'You are an expert Chinese-to-Korean translator for a multicultural LINE business group chat. ' +
  'Translate ONLY. Output ONLY the Korean translation. ' +
  'Casual Chinese → informal Korean (해요체/해체). Formal Chinese → formal Korean (합쇼체). ' +
  'CRITICAL — LINE BREAKS: Preserve every \\n EXACTLY. Numbered items each on own line. NEVER merge lines. ' +
  'KEEP: English, numbers, URLs, emojis, hashtags. ' +
  NAME_RULE + ' Output must contain ZERO Chinese or Japanese characters.';

const PROMPT_EN_TO_KR =
  'You are an expert English-to-Korean translator for a multicultural LINE business group chat. ' +
  'Translate ONLY. Output ONLY the Korean translation. ' +
  'OK/Sure → 알겠습니다/네, ASAP → 최대한 빨리, FYI → 참고로, Got it → 알겠습니다, No worries → 괜찮아요. ' +
  'Casual English → 해요체. Formal English → 합쇼체. ' +
  'CRITICAL — LINE BREAKS: Preserve every \\n EXACTLY. Numbered items each on own line. NEVER merge lines. ' +
  'KEEP: numbers, URLs, emojis, hashtags, brand names. ' + NAME_RULE;

const PROMPT_EN_TO_TH =
  'You are an expert English-to-Thai translator for a multicultural LINE business group chat. ' +
  'Translate ONLY. Output ONLY the Thai translation. ' +
  'OK/Sure → โอเค/ได้เลย, ASAP → โดยเร็วที่สุด, FYI → แจ้งให้ทราบ, Got it → เข้าใจแล้ว, No worries → ไม่เป็นไร. ' +
  'Casual English → ภาษาพูด (นะ อ่ะ). Formal English → ครับ/ค่ะ. ' +
  'CRITICAL — LINE BREAKS: Preserve every \\n EXACTLY. Numbered items each on own line. NEVER merge lines. ' +
  'KEEP: numbers, URLs, emojis, hashtags, brand names. ' + NAME_RULE;

const CALL_TIMEOUT_MS  = 6000;
const OUTER_TIMEOUT_MS = 25000;

const LANG_PAIR = {
  th_to_kr: { from: 'th', to: 'ko', lingva: ['th', 'ko'], myMemory: 'th|ko' },
  kr_to_th: { from: 'ko', to: 'th', lingva: ['ko', 'th'], myMemory: 'ko|th' },
  zh_to_th: { from: 'zh', to: 'th', lingva: ['zh-CN', 'th'], myMemory: 'zh|th' },
  zh_to_kr: { from: 'zh', to: 'ko', lingva: ['zh-CN', 'ko'], myMemory: 'zh|ko' },
  en_to_kr: { from: 'en', to: 'ko', lingva: ['en', 'ko'], myMemory: 'en|ko' },
  en_to_th: { from: 'en', to: 'th', lingva: ['en', 'th'], myMemory: 'en|th' },
};

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms)),
  ]);
}

const LINGVA_INSTANCES = [
  'https://lingva.ml',
  'https://lingva.garudalinux.org',
  'https://translate.plausibility.cloud',
];
async function callLingva(text, dir) {
  const pair = LANG_PAIR[dir];
  if (!pair || !pair.lingva) throw new Error('unknown dir: ' + dir);
  const [src, tgt] = pair.lingva;
  const safe = text.length > 1000 ? text.slice(0, 1000) : text;
  const encoded = encodeURIComponent(safe);
  for (const base of LINGVA_INSTANCES) {
    try {
      const res = await withTimeout(
        axios.get(`${base}/api/v1/${src}/${tgt}/${encoded}`, { headers: { Accept: 'application/json' } }),
        CALL_TIMEOUT_MS
      );
      const out = res.data?.translation;
      if (out && out.trim().length > 0) return out.trim();
    } catch (_) { /* try next */ }
  }
  throw new Error('all lingva instances failed');
}

async function callMyMemory(text, dir) {
  const pair = LANG_PAIR[dir];
  if (!pair) throw new Error('unknown dir: ' + dir);
  const email = process.env.MYMEMORY_EMAIL || '';
  let url = 'https://api.mymemory.translated.net/get?q=' +
    encodeURIComponent(text) + '&langpair=' + pair.myMemory;
  if (email) url += '&de=' + encodeURIComponent(email);
  const res = await withTimeout(axios.get(url), CALL_TIMEOUT_MS);
  const out = res.data?.responseData?.translatedText;
  if (!out || out.toUpperCase().startsWith('PLEASE SELECT') ||
      out.toUpperCase().startsWith('NO QUERY') || out.toUpperCase().startsWith('QUERY LENGTH'))
    throw new Error('mymemory quota/error: ' + out);
  if (res.data?.responseStatus !== 200) throw new Error('mymemory status ' + res.data?.responseStatus);
  return out.trim();
}

async function callGemini(model, systemPrompt, text) {
  const res = await withTimeout(axios.post(
    'https://generativelanguage.googleapis.com/v1beta/models/' + model +
    ':generateContent?key=' + process.env.GEMINI_API_KEY,
    { system_instruction: { parts: [{ text: systemPrompt }] }, contents: [{ parts: [{ text }] }],
      generationConfig: { temperature: 0.1, maxOutputTokens: 1024 } },
    { headers: { 'Content-Type': 'application/json' } }
  ), CALL_TIMEOUT_MS);
  return res.data.candidates[0].content.parts[0].text.trim();
}

async function callGroq(model, systemPrompt, text) {
  const res = await withTimeout(axios.post(
    'https://api.groq.com/openai/v1/chat/completions',
    { model, messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: text }],
      temperature: 0.1, max_tokens: 1024 },
    { headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + process.env.GROQ_API_KEY } }
  ), CALL_TIMEOUT_MS);
  return res.data.choices[0].message.content.trim();
}

async function callCerebras(model, systemPrompt, text) {
  const res = await withTimeout(axios.post(
    'https://api.cerebras.ai/v1/chat/completions',
    { model, messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: text }],
      temperature: 0.1, max_tokens: 1024 },
    { headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + process.env.CEREBRAS_API_KEY } }
  ), CALL_TIMEOUT_MS);
  return res.data.choices[0].message.content.trim();
}

async function callOpenRouter(model, systemPrompt, text) {
  const res = await withTimeout(axios.post(
    'https://openrouter.ai/api/v1/chat/completions',
    { model, messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: text }],
      temperature: 0.1, max_tokens: 1024 },
    { headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + process.env.OPENROUTER_API_KEY } }
  ), CALL_TIMEOUT_MS);
  return res.data.choices[0].message.content.trim();
}

const CASCADE = [
  { id: 'T01', fn: (p, t) => callGroq('llama-3.3-70b-versatile', p, t) },
  { id: 'T02', fn: (p, t, d) => callMyMemory(t, d) },
  { id: 'T03', fn: (p, t) => callGemini('gemini-2.5-pro',              p, t) },
  { id: 'T04', fn: (p, t) => callGroq('moonshotai/kimi-k2-instruct',   p, t) },
  { id: 'T05', fn: (p, t) => callGemini('gemini-2.5-flash',            p, t) },
  { id: 'T06', fn: (p, t) => callGemini('gemini-2.0-flash',            p, t) },
  { id: 'T07', fn: (p, t) => callGroq('llama-3.3-70b-versatile',       p, t) },
  { id: 'T08', fn: (p, t) => callGroq('deepseek-r1-distill-llama-70b', p, t) },
  { id: 'T09', fn: (p, t) => callGroq('qwen-qwq-32b',                  p, t) },
  { id: 'T10', fn: (p, t) => callCerebras('llama3.3-70b',              p, t) },
  { id: 'T11', fn: (p, t) => callGemini('gemini-1.5-flash-latest',     p, t) },
  { id: 'T12', fn: (p, t) => callOpenRouter('meta-llama/llama-3.3-70b-instruct:free', p, t) },
  { id: 'T13', fn: (p, t) => callGroq('llama-3.1-8b-instant',          p, t) },
];

function detectLoop(text) {
  if (!text || text.length < 40) return false;
  for (let i = 0; i + 40 <= text.length; i += 20) {
    const chunk = text.slice(i, i + 40);
    if (text.indexOf(chunk, i + 40) !== -1) return true;
  }
  const seen = new Set();
  for (let i = 0; i + 20 <= text.length; i += 10) {
    const c = text.slice(i, i + 20);
    if (seen.has(c)) return true;
    seen.add(c);
  }
  return false;
}

function isBad(out, dir) {
  if (!out || out.trim().length < 2) return true;
  if (out.includes('->') || out.includes('→')) return true;
  if (detectLoop(out)) return true;
  if (dir === 'th_to_kr' && THAI_RE.test(out))   return true;
  if (dir === 'kr_to_th' && KOREAN_RE.test(out))  return true;
  if ((dir === 'zh_to_th' || dir === 'zh_to_kr') && CJK_RE.test(out) &&
      !THAI_RE.test(out) && !KOREAN_RE.test(out)) return true;
  return false;
}

async function translateWithCascade(text, systemPrompt, dir) {
  const deadline = Date.now() + OUTER_TIMEOUT_MS;
  for (const tier of CASCADE) {
    if (Date.now() >= deadline) { console.warn('[TR] outer timeout at ' + tier.id); break; }
    try {
      const out = await tier.fn(systemPrompt, text, dir);
      if (!isBad(out, dir)) { console.log('[TR] ' + tier.id + ' ok dir=' + dir); return out; }
      console.warn('[TR] ' + tier.id + ' isBad dir=' + dir);
    } catch (e) {
      console.warn('[TR] ' + tier.id + ' err: ' + e.message);
    }
  }
  return null;
}

function stripMentions(text) {
  return text.replace(/@[\w฀-๿가-힯぀-ヿ一-鿿]+/g, '').replace(/\s+/g, ' ').trim();
}

async function translateAll(rawText) {
  const stripped = stripMentions(rawText);
  if (!stripped || stripped.length < 5) return null;
  const withoutUrls = stripped.replace(URL_RE, '').replace(/\s+/g, ' ').trim();
  if (withoutUrls.length < 5) return null;
  if (/^[\d\s\-+().]{5,20}$/.test(stripped)) return null;
  const text = stripped.length > MAX_CHARS ? stripped.slice(0, MAX_CHARS) + '\n...(truncated)' : stripped;
  if (JAPANESE_RE.test(text)) return null;
  if (THAI_RE.test(text)) return { kr: await translateWithCascade(text, PROMPT_TH_TO_KR, 'th_to_kr') };
  if (KOREAN_RE.test(text)) return { th: await translateWithCascade(text, PROMPT_KR_TO_TH, 'kr_to_th') };
  if (CJK_RE.test(text)) {
    const [th, kr] = await Promise.all([
      translateWithCascade(text, PROMPT_ZH_TO_TH, 'zh_to_th'),
      translateWithCascade(text, PROMPT_ZH_TO_KR, 'zh_to_kr'),
    ]);
    return { th, kr };
  }
  if (ENGLISH_RE.test(text) && text.trim().length > 3) {
    const [kr, th] = await Promise.all([
      translateWithCascade(text, PROMPT_EN_TO_KR, 'en_to_kr'),
      translateWithCascade(text, PROMPT_EN_TO_TH, 'en_to_th'),
    ]);
    return { kr, th };
  }
  return null;
}

function verifySignature(rawBody, signature) {
  const hmac = crypto.createHmac('SHA256', CHANNEL_SECRET);
  hmac.update(rawBody);
  return hmac.digest('base64') === signature;
}

// FIX: re-throw after logging → push fallback in scheduleTranslation (server.js) will fire
// DEBUG 2026-07-31: log replyToken prefix + HTTP status to diagnose failures
async function replyMessages(replyToken, messages) {
  const isDummy = !replyToken || /^0+$/.test(replyToken);
  console.log('[LINE] tok:', replyToken ? replyToken.slice(0,15) : 'NULL', 'len:', replyToken?.length, isDummy ? 'DUMMY' : 'ok');
  if (isDummy) { throw new Error('dummy reply token'); }
  try {
    await axios.post(
      LINE_API_BASE + '/message/reply',
      { replyToken, messages },
      { headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + ACCESS_TOKEN } }
    );
    console.log('[LINE] Reply ok');
  } catch (err) {
    console.error('[LINE] Reply failed (HTTP', err.response?.status, '):', err.response?.data ?? err.message);
    throw err; // re-throw so .catch() in scheduleTranslation fires push fallback
  }
}

async function getSenderName(event) {
  try {
    const { userId, groupId, roomId } = event.source;
    let url;
    if (groupId)     url = LINE_API_BASE + '/group/' + groupId + '/member/' + userId;
    else if (roomId) url = LINE_API_BASE + '/room/' + roomId + '/member/' + userId;
    else             url = LINE_API_BASE + '/profile/' + userId;
    const res = await axios.get(url, { headers: { Authorization: 'Bearer ' + ACCESS_TOKEN } });
    return res.data.displayName ?? userId;
  } catch {
    return event.source?.userId ?? 'Unknown';
  }
}

module.exports = { verifySignature, translateAll, replyMessages, getSenderName };
