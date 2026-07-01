/**
 * cronJob.js
 * Scheduled tasks:
 *  Every hour     → pipeline (LINE → AI → Lark hub)
 *  Every 5 min    → stale chat check → 🚨 Alert room
 *  08:30 weekdays → morning summary → 📋 Summary room
 *  17:45 weekdays → DEEP evening analysis (full day log) → 📋 Summary room
 *
 * dailyLog: accumulates ALL messages throughout day for rich evening analysis
 */
require('dotenv').config();
const cron = require('node-cron');
const { isBusinessHours }  = require('./timeRouter');
const { isWorkingDay }     = require('./holidays');
const { flushMessages }    = require('./messageStore');
const {
  getStaleGroups, setAlertLevel,
  flushOffHoursMessages, getAllGroupsWithOffHours,
} = require('./messageTracker');
const { sendToLarkGroup, sendStaleAlert, sendSummaryCard } = require('./larkMessenger');
const { summarizeForLark } = require('./aiSummarizer');

let morningSummaryDate = null;

// ── Daily Log — accumulates ALL messages for deep end-of-day analysis ─────────
let dailyLog     = [];
let dailyLogDate = null;

function accumulateToDailyLog(messages) {
  const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });
  if (dailyLogDate !== todayStr) {
    dailyLog     = [];          // new day — reset
    dailyLogDate = todayStr;
    console.log(`[CRON] dailyLog reset for ${todayStr}`);
  }
  dailyLog.push(...messages);
}

// ─── Pipeline (hourly) ────────────────────────────────────────────────────────
async function runPipeline() {
  const messages = flushMessages();
  if (!messages.length) { console.log('[CRON] pipeline: no messages'); return; }

  // Keep full-day copy for evening deep analysis
  accumulateToDailyLog(messages);

    const now        = new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' });
  const groupNames = [...new Set(messages.map(m => m.groupName).filter(Boolean))];
  const groupLabel = groupNames.length ? ` - ${groupNames.join(', ')}` : '';
  const summary    = await summarizeForLark(messages, 'pipeline');
  console.log(`[CRON] pipeline: ${messages.length} msgs → Lark`);
  await sendToLarkGroup(
    `📊 สรุปงาน LINE${groupLabel} (${now})\nจำนวนข้อความ: ${messages.length} รายการ\n\n${summary}`
  );
}

// ─── Stale-chat check (every 5 min) ──────────────────────────────────────────
const MIN15 = 15 * 60 * 1000;
const MIN30 = 30 * 60 * 1000;

async function checkStaleChats() {
  if (!isBusinessHours()) return;
  const stale = getStaleGroups(MIN15);
  for (const { groupId, ageMs, lastSenderName, lastText, alertLevel } of stale) {
    const mins = Math.floor(ageMs / 60000);
    if (ageMs >= MIN30 && alertLevel !== 'red') {
      setAlertLevel(groupId, 'red');
      await sendStaleAlert(
        `🔴 แชทค้าง ${mins} นาที — ยังไม่มีใครตอบ!`,
        `**กลุ่ม:** ${groupId}\n**ข้อความล่าสุด:** ${lastSenderName}: ${lastText.slice(0,100)}\n\n⚠️ โปรดติดต่อลูกค้าด่วนที่สุด!`,
        'red'
      );
    } else if (ageMs >= MIN15 && alertLevel === null) {
      setAlertLevel(groupId, 'yellow');
      await sendStaleAlert(
        `🟡 แชทรอตอบ ${mins} นาที`,
        `**กลุ่ม:** ${groupId}\n**ข้อความล่าสุด:** ${lastSenderName}: ${lastText.slice(0,100)}`,
        'yellow'
      );
    }
  }
}

// ─── Morning summary ──────────────────────────────────────────────────────────
async function sendMorningSummary() {
  const now = new Date();
  if (!isWorkingDay(now)) return;
  const todayStr = now.toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });
  if (morningSummaryDate === todayStr) { console.log('[CRON] morning summary already ran'); return; }
  morningSummaryDate = todayStr;

  const date     = now.toLocaleDateString('th-TH', { timeZone:'Asia/Bangkok', dateStyle:'full' });
  const groupIds = getAllGroupsWithOffHours();
  console.log(`[CRON] morning summary → ${date}`);

  if (groupIds.length) {
    for (const groupId of groupIds) {
      const msgs = flushOffHoursMessages(groupId);
      if (!msgs.length) continue;
      const summary = await summarizeForLark(msgs, 'morning');
      await sendSummaryCard(
        `🌅 สรุปข้อความนอกเวลา — ${date}`,
        `📩 **กลุ่ม:** ${groupId}\n📊 **จำนวน:** ${msgs.length} ข้อความ\n\n${summary}\n\n> ⚡ กรุณาวางแผนงานก่อนเริ่มงาน`
      );
    }
  } else {
    await sendSummaryCard(
      `🌅 เริ่มต้นวันทำงาน — ${date}`,
      `✅ ไม่มีข้อความค้างจากนอกเวลางาน\n\n💼 พร้อมรับงานใหม่วันนี้!`
    );
  }
}

// ─── Evening deep analysis (17:45) ───────────────────────────────────────────
async function sendEveningSummary() {
  const now = new Date();
  if (!isWorkingDay(now)) return;

  // Collect final hour + full day log
  const finalBatch  = flushMessages();
  if (finalBatch.length) accumulateToDailyLog(finalBatch);

  const allMessages = [...dailyLog];
  dailyLog = []; dailyLogDate = null; // reset for tomorrow

  const date = now.toLocaleDateString('th-TH', { timeZone:'Asia/Bangkok', dateStyle:'full' });
  console.log(`[CRON] evening deep analysis: ${allMessages.length} msgs total today`);

  if (!allMessages.length) {
    await sendSummaryCard(
      `🌆 สรุปสิ้นวัน — ${date}`,
      `✅ ไม่มีข้อความในกลุ่มวันนี้\n\n🏠 พักผ่อนให้เต็มที่!`
    );
    return;
  }

  const summary = await summarizeForLark(allMessages, 'evening');
  await sendSummaryCard(
    `🌆 รายงานสิ้นวัน (วิเคราะห์เชิงลึก) — ${date}`,
    `📊 **ข้อความทั้งวัน:** ${allMessages.length} รายการ\n\n${summary}\n\n> 🧠 วิเคราะห์โดย อูจิน (우진) AI 8 ชั้น · Wisdom International`
  );
}

// ─── Startup catch-up ─────────────────────────────────────────────────────────
function catchUpMorningSummary() {
  const now = new Date();
  const bkk = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Bangkok' }));
  const min = bkk.getHours() * 60 + bkk.getMinutes();
  if (min >= 510 && min <= 630 && isWorkingDay(now)) {
    console.log('[CRON] catch-up: running missed morning summary');
    sendMorningSummary().catch(e => console.error('[CRON] catch-up error:', e.message));
  }
}

// ─── Start ────────────────────────────────────────────────────────────────────
function startCronJob() {
  cron.schedule('0 * * * *',      runPipeline,        { timezone: 'Asia/Bangkok' });
  cron.schedule('*/5 * * * *',    checkStaleChats,    { timezone: 'Asia/Bangkok' });
  cron.schedule('30 8 * * 1-5',   sendMorningSummary, { timezone: 'Asia/Bangkok' });
  cron.schedule('45 17 * * 1-5',  sendEveningSummary, { timezone: 'Asia/Bangkok' });
  console.log('[CRON] 4 jobs started (BKK) — dailyLog accumulation active');
  setTimeout(catchUpMorningSummary, 5000);
}

module.exports = { startCronJob, runPipeline };
