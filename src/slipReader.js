'use strict';
/**
 * slipReader.js
 * Downloads a LINE image message and uses Gemini Vision (free tier)
 * to extract Thai bank transfer slip data.
 *
 * Returns: { amount: number, date: string, ref: string, isValid: boolean }
 */

const axios = require('axios');

/**
 * Download raw image bytes from LINE content API.
 */
async function downloadLineImage(messageId) {
  const res = await axios.get(
    `https://api-data.line.me/v2/bot/message/${messageId}/content`,
    {
      headers: { Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}` },
      responseType: 'arraybuffer',
      timeout: 12000,
    }
  );
  return Buffer.from(res.data);
}

/**
 * Send image to Gemini Vision REST API and extract slip fields.
 * Uses gemini-2.0-flash (free tier).
 */
async function readSlip(messageId) {
  let imageBuffer;
  try {
    imageBuffer = await downloadLineImage(messageId);
  } catch (err) {
    console.error('[SlipReader] Image download failed:', err.message);
    return { amount: 0, date: '', ref: '', isValid: false };
  }

  const base64Image = imageBuffer.toString('base64');

  const prompt = `You are reading a Thai bank transfer or payment confirmation slip.
Extract the following and respond ONLY with valid JSON (no markdown, no explanation):
{
  "amount": <number — the total transferred amount in Thai Baht, digits only, e.g. 5000>,
  "date": <string — transfer date as YYYYMMDD, e.g. "20260902">,
  "ref": <string — transaction/reference number if visible, else "">,
  "isValid": <boolean — true only if this is clearly a bank transfer/payment slip>
}

Rules:
- If this is NOT a bank slip, set isValid to false and amount to 0.
- Never process passport, national ID, or personal identity documents.
- Amount must be a plain number without commas or currency symbols.
- If the transfer amount is unclear, set isValid to false.`;

  const body = {
    contents: [{ parts: [
      { inline_data: { mime_type: 'image/jpeg', data: base64Image } },
      { text: prompt },
    ] }],
    generationConfig: { temperature: 0, maxOutputTokens: 256 },
  };

  let text = '';
  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${process.env.GEMINI_API_KEY}`;
    const res = await axios.post(url, body, { timeout: 20000 });
    text = res.data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
  } catch (err) {
    console.error('[SlipReader] Gemini call failed:', err.response?.data ?? err.message);
    return { amount: 0, date: '', ref: '', isValid: false };
  }

  // Strip markdown code fences if Gemini adds them
  const clean = text.replace(/```(?:json)?|```/g, '').trim();

  let parsed;
  try {
    parsed = JSON.parse(clean);
  } catch {
    console.error('[SlipReader] JSON parse error. Raw:', clean.slice(0, 200));
    return { amount: 0, date: '', ref: '', isValid: false };
  }

  if (!parsed.isValid || !parsed.amount || Number(parsed.amount) <= 0) {
    console.log('[SlipReader] Not a valid slip or zero amount.');
    return { amount: 0, date: '', ref: '', isValid: false };
  }

  const result = {
    amount: Number(parsed.amount),
    date:   String(parsed.date ?? ''),
    ref:    String(parsed.ref  ?? ''),
    isValid: true,
  };
  console.log('[SlipReader] Extracted:', result);
  return result;
}

module.exports = { readSlip };
