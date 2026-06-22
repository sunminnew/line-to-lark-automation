/**
 * aiSummarizer.js
 * Sends buffered messages to OpenAI and returns structured task objects.
 *
 * Swap the OpenAI client for Anthropic's SDK if you prefer Claude:
 *   import Anthropic from '@anthropic-ai/sdk';
 */

const OpenAI = require('openai');

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

/**
 * Formats the stored message array into a readable block for the AI.
 * @param {Array<{timestamp: string, senderName: string, text: string}>} messages
 * @returns {string}
 */
function buildUserContent(messages) {
  return messages
    .map(m => `[${m.timestamp}] ${m.senderName}: ${m.text}`)
    .join('\n');
}

/**
 * Calls the AI model and returns a parsed tasks array.
 * @param {Array} messages
 * @returns {Promise<Array<{summary, description, priority, client_name}>>}
 */
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
      temperature: 0.2,        // Low temperature → deterministic JSON
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user',   content: userContent   },
      ],
    });

    const raw = completion.choices[0].message.content;
    const parsed = JSON.parse(raw);

    const tasks = parsed.tasks ?? [];
    console.log(`[AI] Identified ${tasks.length} task(s).`);
    return tasks;

  } catch (err) {
    console.error('[AI] Summarization failed:', err.message);
    return [];
  }
}

module.exports = { summarizeMessages };
