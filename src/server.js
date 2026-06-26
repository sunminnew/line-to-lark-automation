/**
 * server.js — LINE → Groq AI → Lark
 * Rooms:
 *   📣 All Updates → hourly pipeline (main hub)
 *   🚨 Alert room  → stale-chat yellow/red alerts (cronJob)
 *   📋 Summary room → สรุป keyword + morning/evening summaries
 */
require('dotenv').config();
const express = require('express');
const axios   = require('axios');
const { isBusinessHours, getBangkokTime } = require('./timeRouter');
const { isWorkingDay }                    = require('./holidays');
const { addMessage, flushMessages }       = require('./messageStore');
const {
  verifySignature, translateAll,
  replyMessages, getSenderName, OOO_MESSAGE,
} = require('./lineHandler');
const { startCronJob, runPipeline }     = require('./cronJob');
const { startKeepAlive }                = require('./keepAlive');
const { summarizeForLark }              = require('./aiSummarizer');
const { sendToLarkGroup, sendSummaryCard, sendAlertCard } = require('./larkMessenger');
const { recordActivity, addOffHoursMessage } = require('./messageTracker');

const app  = express();
const PORT = process.env.PORT ?? 3000;

const LINE_TOKEN  = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const WEBHOOK_URL = 'https://line-to-lark-automation.onrender.com/webhook';

// ── OOO deduplication — send once per calendar day per source ─────────────────
// Key: sourceId  Value: Bangkok date string 'YYYY-MM-DD'
const oooSentMap = new Map();

function shouldSendOOO(sourceId) {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });
  if (oooSentMap.get(sourceId) === today) return false;
  oooSentMap.set(sourceId, today);
  return true;
}

// ── LINE 5,000-char limit guard ───────────────────────────────────────────────
// LINE rejects text messages longer than 5,000 chars.
// Split long translations into multiple bubbles (max 4 chunks × 4,900 chars).
const MAX_LINE_TEXT = 4900;

function toLineMessages(prefix, text) {
  const full = prefix + text;
  if (full.length <= MAX_LINE_TEXT) return [{ type: 'text', text: full }];
  const chunks = [];
  for (let i = 0; i < full.length && chunks.length < 4; i += MAX_LINE_TEXT) {
    chunks.push({ type: 'text', text: full.slice(i, i + MAX_LINE_TEXT) });
  }
  return chunks;
}

/** Reject with Error after ms */
function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
    ),
  ]);
}

app.use(express.json({ verify: (req, _res, buf) => { req.rawBody = buf; } }));

const SUMMARY_KEYWORDS = ['สรุป','สรุปงาน','สรุปแชท','/สรุป','summary','/summary'];
function isSummaryRequest(text) {
  const t = text.trim().toLowerCase();
  return SUMMARY_KEYWORDS.some(k => t === k || t.startsWith(k + ' '));
}

// ── Health check ──────────────────────────────────────────────────────────────
app.get('/', (_req, res) => res.json({
  status: 'ok',
  bangkokTime: getBangkokTime(),
  businessHours: isBusinessHours(),
  workingDay: isWorkingDay(new Date()),
  rooms: {
    hub:     'oc_626fd292d23700898b50fd059c1798ed',
    alert:   'oc_339458a388434ff81afde59342b511b3',
    summary: 'oc_a62e855cfd58229964b2d68b224288b8',
  },
}));

// ── Check & set LINE webhook ──────────────────────────────────────────────────
app.get('/check-webhook', async (_req, res) => {
  try {
    const r = await axios.get('https://api.line.me/v2/bot/channel/webhook/endpoint', {
      headers: { Authorization: `Bearer ${LINE_TOKEN}` },
    });
    res.json({ current: r.data, expected: WEBHOOK_URL, match: r.data.endpoint === WEBHOOK_URL });
  } catch (err) {
    res.status(500).json({ error: err.response?.data ?? err.message });
  }
});

app.post('/setup-webhook', async (_req, res) => {
  try {
    const r = await axios.put(
      'https://api.line.me/v2/bot/channel/webhook/endpoint',
      { webhookEndpointUrl: WEBHOOK_URL },
      { headers: { Authorization: `Bearer ${LINE_TOKEN}`, 'Content-Type': 'application/json' } }
    );
    res.json({ set: WEBHOOK_URL, lineResponse: r.data });
  } catch (err) {
    res.status(500).json({ error: err.response?.data ?? err.message });
  }
});

// ── Manual pipeline trigger ───────────────────────────────────────────────────
app.post('/trigger', async (_req, res) => {
  await runPipeline();
  res.json({ status: 'pipeline executed' });
});

// ── E2E test ──────────────────────────────────────────────────────────────────
app.get('/e2e-test', async (_req, res) => {
  try {
    const fakeMessages = [
      { timestamp: new Date().toISOString(), senderName: 'ทดสอบ', text: 'ประชุมกับลูกค้า ABC เรื่องสัญญาใหม่' },
      { timestamp: new Date().toISOString(), senderName: 'ทดสอบ', text: 'ส่งเอกสาร visa application ให้ทีม HR' },
      { timestamp: new Date().toISOString(), senderName: 'ทดสอบ', text: 'อัพเดต timeline งาน Legal ให้ผู้บริหาร' },
    ];
    const summary = await summarizeForLark(fakeMessages, 'e2e-test');
    const now     = new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' });
    const msgId   = await sendSummaryCard(
      `📋 E2E Test — ${now}`,
      `🧪 ทดสอบระบบสำเร็จ!\nจำนวนข้อความ: ${fakeMessages.length} รายการ\n\n${summary}`
    );
    res.json({ success: !!msgId, msgId, room: 'summary' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── LINE Webhook ──────────────────────────────────────────────────────────────
app.post('/webhook', async (req, res) => {
  const signature = req.headers['x-line-signature'];
  if (!signature || !verifySignature(req.rawBody, signature)) {
    return res.status(401).json({ error: 'Invalid signature' });
  }
  // Respond 200 immediately — replyToken valid for 30 s from here
  res.sendStatus(200);

  for (const event of req.body.events ?? []) {

    // ── JOIN event: bot added to a group ──────────────────────────────────
    if (event.type === 'join') {
      const groupId = event.source?.groupId ?? event.source?.roomId ?? 'unknown';
      const now     = new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' });
      console.log(`[JOIN] Bot joined group: ${groupId}`);
      try {
        await sendAlertCard(
          '✅ อูจินเข้ากลุ่มใหม่',
          `🤖 **อูจิน (우진)** ถูกเพิ่มเข้ากลุ่ม LINE แล้วครับ\n\n📌 **Group ID:** ${groupId}\n🕐 **เวลา:** ${now}\n\nพร้อมแปลภาษาและสรุปงานให้ทีมแล้วครับ 🙏`,
          'green'
        );
      } catch (err) {
        console.error('[JOIN] Lark alert failed:', err.message);
      }
      continue;
    }

    // ── LEAVE event: bot removed from a group ─────────────────────────────
    if (event.type === 'leave') {
      const groupId = event.source?.groupId ?? event.source?.roomId ?? 'unknown';
      const now     = new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' });
      console.log(`[LEAVE] Bot removed from group: ${groupId}`);
      try {
        await sendAlertCard(
          '⚠️ อูจินถูกนำออกจากกลุ่ม',
          `🚨 **อูจิน (우진)** ถูกนำออกจากกลุ่ม LINE\n\n📌 **Group ID:** ${groupId}\n🕐 **เวลา:** ${now}\n\n⚠️ หากต้องการให้บอทกลับมา กรุณาเพิ่มเข้ากลุ่มใหม่ครับ`,
          'red'
        );
      } catch (err) {
        console.error('[LEAVE] Lark alert failed:', err.message);
      }
      continue;
    }

    // ── MESSAGE events only ───────────────────────────────────────────────
    if (event.type !== 'message' || event.message?.type !== 'text') continue;
    const text = event.message.text?.trim();
    if (!text) continue;

    const sourceId   = event.source?.groupId ?? event.source?.roomId ?? event.source?.userId ?? 'unknown';
    const inBizHours = isBusinessHours();
    const isWorking  = isWorkingDay(new Date());
    const timestamp  = new Date(event.timestamp).toISOString();

    let senderName = 'ผู้ใช้';
    try { senderName = await withTimeout(getSenderName(event), 5000, 'getSenderName'); } catch (_) {}

    // 1. Record activity
    recordActivity(sourceId, senderName, text);

    // 2. สรุป keyword → 📋 Summary room
    if (isSummaryRequest(text)) {
      try {
        await replyMessages(event.replyToken, [{ type: 'text', text: '📋 กำลังสรุปงานและส่งไป Lark นะครับ รอสักครู่...' }]);
        const msgs = flushMessages();
        if (!msgs.length) {
          await sendSummaryCard('📋 ไม่มีข้อความที่จะสรุป', 'ยังไม่มีข้อความสะสมในระบบครับ');
        } else {
          const summary = await withTimeout(summarizeForLark(msgs, sourceId), 25000, 'summarize');
          const now     = new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' });
          await sendSummaryCard(
            `📋 สรุปบทสนทนา LINE — ${now}`,
            `📌 **ขอโดย:** ${senderName}\n📊 **จำนวน:** ${msgs.length} ข้อความ\n\n${summary}`
          );
        }
      } catch (err) {
        console.error('[webhook] summary error:', err.message);
      }
      continue;
    }

    // 3. Off-hours buffer
    if (!inBizHours || !isWorking) {
      addOffHoursMessage(sourceId, { timestamp, senderName, text });
    }

    // 4. Translate 24/7 — 20 s timeout
    try {
      const translations = await withTimeout(translateAll(text), 20000, 'translateAll');
      const replies = [];
      // Split long translations into multiple bubbles (LINE max 5,000 chars/msg)
      if (translations?.kr) replies.push(...toLineMessages('KR: ', translations.kr));
      if (translations?.th) replies.push(...toLineMessages('TH: ', translations.th));
      // OOO — send only ONCE per day per source
      if ((!inBizHours || !isWorking) && shouldSendOOO(sourceId)) {
        replies.push({ type: 'text', text: OOO_MESSAGE });
      }
      if (replies.length) {
        try {
          // LINE allows max 5 messages per reply token
          await replyMessages(event.replyToken, replies.slice(0, 5));
        } catch (replyErr) {
          console.error('[webhook] reply error:', replyErr.message,
            replyErr.response?.data ? JSON.stringify(replyErr.response.data) : '');
        }
      }
    } catch (err) {
      console.error('[webhook] translate error:', err.message,
        err.response?.data ? JSON.stringify(err.response.data) : '');
      try {
        await replyMessages(event.replyToken, [{
          type: 'text',
          text: '⚠️ ขณะนี้ระบบแปลชั่วคราวไม่พร้อมใช้งาน กรุณาลองใหม่อีกครั้งครับ',
        }]);
      } catch (_) {}
    }

    // 5. Business-hours buffer for hourly pipeline
    if (inBizHours && isWorking) {
      addMessage({ timestamp, senderName, text });
    }
  }
});

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log('\n🚀 Server running on port ' + PORT);
  console.log(' Bangkok time : ' + getBangkokTime());
  console.log(' Business hrs : ' + (isBusinessHours() ? 'YES ✅' : 'NO ❌'));
  console.log(' Rooms ready  : Hub | Alert | Summary');
  startCronJob();
  startKeepAlive();
});
