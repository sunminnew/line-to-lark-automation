/**
 * cronJob.js
 * Scheduled tasks:
 *   Every hour     → run pipeline (LINE → Groq → Lark hub)
 *   Every 5 min    → check stale chats → 🚨 Alert room
 *   07:45 weekdays → morning summary + off-hours flush → 📋 Summary room
 *   17:45 weekdays → evening summary → 📋 Summary room
 */
require('dotenv').config();
const cron = require('node-cron');
const { isBusinessHours } = require('./timeRouter');
const { isWorkingDay }    = require('./holidays');
const { flushMessages }   = require('./messageStore');
const {
  getStaleGroups, setAlertLevel, getAlertLevel,
  flushOffHoursMessages, getAllGroupsWithOffHours,
} = require('./messageTracker');
const { sendToLarkGroup, sendStaleAlert, sendSummaryCard } = require('./larkMessenger');
const { summarizeForLark } = require('./aiSummarizer');

// ─── Pipeline (hourly) ────────────────────────────────────────────────────────
async function runPipeline() {
  const messages = flushMessages();
  if (!messages.length) {
    console.log('[CRON] pipeline: no messages');
    return;
  }
  const now = new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' });
  console.log(`[CRON] pipeline: ${messages.length} msgs → Lark hub`);
  const summary = await summarizeForLark(messages, 'pipeline');
  await sendToLarkGroup(
    `📊 สรุปงาน LINE (${now})\nจำนวนข้อความ: ${messages.length} รายการ\n\n${summary}`
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
        `**กลุ่ม:** ${groupId}\n**ข้อความล่าสุด:** ${lastSenderName}: ${lastText.slice(0, 100)}\n\n⚠️ โปรดติดต่อลูกค้าด่วนที่สุด!`,
        'red'
      );
    } else if (ageMs >= MIN15 && alertLevel === null) {
      setAlertLevel(groupId, 'yellow');
      await sendStaleAlert(
        `🟡 แชทรอตอบ ${mins} นาที`,
        `**กลุ่ม:** ${groupId}\n**ข้อความล่าสุด:** ${lastSenderName}: ${lastText.slice(0, 100)}`,
        'yellow'
      );
    }
  }
}

// ─── Morning summary (07:45 weekdays) ────────────────────────────────────────
async function sendMorningSummary() {
  const now = new Date();
  if (!isWorkingDay(now)) return;
  const date = now.toLocaleDateString('th-TH', { timeZone: 'Asia/Bangkok', dateStyle: 'full' });

  // Flush off-hours messages from all groups
  const groupIds = getAllGroupsWithOffHours();
  if (groupIds.length) {
    for (const groupId of groupIds) {
      const msgs = flushOffHoursMessages(groupId);
      if (!msgs.length) continue;
      const summary = await summarizeForLark(msgs, groupId);
      await sendSummaryCard(
        `🌅 สรุปข้อความนอกเวลา — ${date}`,
        `📩 **กลุ่ม:** ${groupId}\n📊 **จำนวน:** ${msgs.length} ข้อความ (รับระหว่างนอกเวลางาน)\n\n${summary}\n\n> ⚡ กรุณาวางแผนงานและจัดการ Task ก่อนเริ่มงาน`
      );
    }
  } else {
    await sendSummaryCard(
      `🌅 เริ่มต้นวันทำงาน — ${date}`,
      `✅ ไม่มีข้อความค้างจากนอกเวลางาน\n\n💼 พร้อมรับงานใหม่วันนี้!`
    );
  }
}

// ─── Evening summary (17:45 weekdays) ────────────────────────────────────────
async function sendEveningSummary() {
  const now = new Date();
  if (!isWorkingDay(now)) return;
  const messages = flushMessages();
  const date = now.toLocaleDateString('th-TH', { timeZone: 'Asia/Bangkok', dateStyle: 'full' });

  if (!messages.length) {
    await sendSummaryCard(
      `🌆 สรุปสิ้นวัน — ${date}`,
      `✅ ไม่มีข้อความในกลุ่มวันนี้\n\n🏠 พักผ่อนให้เต็มที่!`
    );
    return;
  }
  const summary = await summarizeForLark(messages, 'evening');
  await sendSummaryCard(
    `🌆 สรุปงานสิ้นวัน — ${date}`,
    `📊 **จำนวนข้อความวันนี้:** ${messages.length} รายการ\n\n${summary}\n\n> 🎯 ตรวจสอบงานค้างก่อนกลับบ้าน`
  );
}

// ─── Start all crons ──────────────────────────────────────────────────────────
function startCronJob() {
  // Hourly pipeline → main hub
  cron.schedule('0 * * * *', runPipeline, { timezone: 'Asia/Bangkok' });
  // Every 5 min stale check → alert room
  cron.schedule('*/5 * * * *', checkStaleChats, { timezone: 'Asia/Bangkok' });
  // Morning 07:45 Mon-Fri → summary room
  cron.schedule('45 7 * * 1-5', sendMorningSummary, { timezone: 'Asia/Bangkok' });
  // Evening 17:45 Mon-Fri → summary room
  cron.schedule('45 17 * * 1-5', sendEveningSummary, { timezone: 'Asia/Bangkok' });
  console.log('[CRON] All 4 jobs started (BKK timezone)');
}

module.exports = { startCronJob, runPipeline };
