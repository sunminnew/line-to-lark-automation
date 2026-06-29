/**
 * aiSummarizer.js
 * Two summarization modes:
 *  1. summarizeMessages()  — OpenAI → structured Lark Tasks (existing hourly cron)
 *  2. summarizeForLark()   — Groq   → Thai intelligent chat summary (keyword trigger)
 */

const OpenAI = require('openai');
const axios  = require('axios');

// ── OpenAI (existing cron pipeline) ──────────────────────────────────────────
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
  if (messages.length === 0) {
    console.log('[AI] No messages to summarize.');
    return [];
  }

  const userContent = buildUserContent(messages);
  console.log(`[AI] Sending ${messages.length} messages to ${MODEL}...`);

  try {
    const completion = await client.chat.completions.create({
      model: MODEL,
      temperature: 0.2,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user',   content: userContent   },
      ],
    });

    const raw    = completion.choices[0].message.content;
    const parsed = JSON.parse(raw);
    const tasks  = parsed.tasks ?? [];
    console.log(`[AI] Identified ${tasks.length} task(s).`);
    return tasks;

  } catch (err) {
    console.error('[AI] Summarization failed:', err.message);
    return [];
  }
}

// ── Groq (keyword-triggered Thai summary for Lark) ────────────────────────────

const GROQ_API_KEY   = process.env.GROQ_API_KEY;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GROQ_MODEL          = 'llama-3.3-70b-versatile';
const GROQ_MODEL_FALLBACK = 'llama-3.1-8b-instant';

const THAI_SUMMARY_PROMPT = `คุณคือผู้ช่วยสรุปงานระดับมืออาชีพที่วิเคราะห์บทสนทนาแล้วสรุปเป็นภาษาไทยอย่างชาญฉลาด

กรุณาสรุปบทสนทนาต่อไปนี้ในรูปแบบ:

📋 *ภาพรวม*
[สรุปสั้นๆ 2-3 ประโยค]

✅ *งานที่ต้องทำ*
[รายการงาน พร้อมผู้รับผิดชอบ ถ้ามี]

⚠️ *ประเด็นสำคัญ*
[ข้อมูลสำคัญ ปัญหา หรือการตัดสินใจ ถ้ามี]

👥 *ผู้เกี่ยวข้อง*
[ชื่อพนักงานและบทบาทที่กล่าวถึง]

หากไม่มีข้อมูลในหมวดใด ให้ข้ามหมวดนั้น
ตอบเป็นภาษาไทยเท่านั้น กระชับ ตรงประเด็น`;

/**
 * Summarise a group's messages into Thai using Groq — for sending to Lark.
 * @param {Array<{timestamp, senderName, text}>} messages
 * @param {string} [groupLabel]  Human-readable group name for the header
 * @returns {Promise<string>}    Formatted Thai summary text
 */
async function summarizeForLark(messages, groupLabel = 'LINE Group') {
  if (messages.length === 0) {
    return '(ไม่มีข้อความในกลุ่มนี้)';
  }

  const conversation = messages
    .map(m => `[${new Date(m.timestamp).toLocaleTimeString('th-TH')}] ${m.senderName}: ${m.text}`)
    .join('\n');

  const userPrompt = `บทสนทนาจากกลุ่ม "${groupLabel}" (${messages.length} ข้อความ):\n\n${conversation}`;

  console.log(`[AI-Groq] Summarising ${messages.length} messages for Lark...`);

  try {
    const res = await axios.post(
      'https://api.groq.com/openai/v1/chat/completions',
      {
        model: GROQ_MODEL,
        messages: [
          { role: 'system', content: THAI_SUMMARY_PROMPT },
          { role: 'user',   content: userPrompt          },
        ],
        temperature: 0.3,
        max_tokens:  1000,
      },
      {
        headers: {
          'Content-Type': 'application/json',
          Authorization:  `Bearer ${GROQ_API_KEY}`,
        },
      }
    );

    const summary = res.data.choices[0].message.content.trim();
    console.log('[AI-Groq] Summary generated successfully.');
    return summary;

  } catch (err) {
    const status = err.response?.status;
    const isQuota = status === 429 || status === 413;

    // Tier-2: retry with 8b model
    if (isQuota && err._model !== GROQ_MODEL_FALLBACK) {
      console.log('[AI-Groq] 70b quota → retrying with 8b');
      try {
        const r2 = await axios.post(
          'https://api.groq.com/openai/v1/chat/completions',
          { model: GROQ_MODEL_FALLBACK, messages: [
              { role: 'system', content: THAI_SUMMARY_PROMPT },
              { role: 'user',   content: userPrompt },
            ], temperature: 0.3, max_tokens: 1000 },
          { headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${GROQ_API_KEY}` } }
        );
        return r2.data.choices[0].message.content.trim();
      } catch (err2) {
        const s2 = err2.response?.status;
        if ((s2 === 429 || s2 === 413) && GEMINI_API_KEY) {
          // Tier-3: Gemini
          console.log('[AI-Groq] Both Groq models quota → falling back to Gemini');
          try {
            const gRes = await axios.post(
              `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`,
              { contents: [{ parts: [{ text: THAI_SUMMARY_PROMPT + '\n\n' + userPrompt }] }],
                generationConfig: { temperature: 0.3, maxOutputTokens: 1000 } }
            );
            return gRes.data.candidates[0].content.parts[0].text.trim();
          } catch (gErr) {
            console.error('[AI-Gemini] Summary failed:', gErr.message);
          }
        }
      }
    }
    console.error('[AI-Groq] Summarisation failed:', err.response?.data ?? err.message);
    return '❌ ขออภัย ไม่สามารถสรุปงานได้ในขณะนี้ กรุณาลองใหม่อีกครั้ง';
  }
}

module.exports = { summarizeMessages, summarizeForLark };
