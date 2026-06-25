/**
 * cronJob.js
 * Scheduled jobs (Asia/Bangkok):
 *   - Hourly pipeline      :00 every hour (business hours only)
 *   - Stale-chat alerts   every 5 min (business hours only)
 *   - Morning summary     07:45 weekdays
 *   - Evening summary     17:45 weekdays
 */

const cron = require('node-cron');
const { isBusinessHours, getBangkokTime } = require('./timeRouter');
const { flushMessages }    = require('./messageStore');
const { summarizeMessages, summarizeForLark } = require('./aiSummarizer');
const { createTasksInLark } = require('./larkIntegration');
const { sendToLarkGroup, sendAlertCard } = require('./larkMessenger');
const {
  getStaleGroups, setAlertLevel,
  flushOffHoursMessages, getAllGroupsWithOffHours,
} = require('./messageTracker');

const MIN15 = 15 * 60 * 1000;
const MIN30 = 30 * 60 * 1000;

// ─── Hourly pipeline ──────────────────────────────────────────────────────────
async function runPipeline() {
  console.log(`\n[Cron] ⏰ Pipeline at ${getBangkokTime()}`);
  if (!isBusinessHours()) { console.log('[Cron] Outside biz hours — skip.'); return; }
  const messages = flushMessages();
  if (!messages.length)  { console.log('[Cron] No messages.'); return; }
  const tasks = await summarizeMessages(messages);
  if (!tasks.length)     { console.log('[Cron] No actionable tasks.'); return; }
  const ids = await createTasksInLark(tasks);
  console.log(`[Cron] ✅ Created ${ids.length} task(s):, ids`);
}

// ─── Stale-chat alert (every 5 min during business hours) ────────────────────
async function checkStaleChats() {
  if (!isBusinessHours()) return;
  const stale = getStaleGroups(MIN15);
  for (const { groupId, ageMs, lastSenderName, lastText, alertLevel } of stale) {
    const mins = Math.floor(ageMs / 60000);
    const preview = `${lastSenderName}: ${lastText.slice(0, 80)}`;

    if (ageMs >= MIN30 && alertLevel !== 'red') {
      setAlertLevel(groupId, 'red');
      await sendAlertCard(
        `🔴 แชทค้าง ${mins} นาที — ยังไม่มีใครตอบ!`,
        `**ข้อความล่าสุด:** ${preview}\n\n⚠️ โปรดติดต่อลูกค้าด่วน`,
        'red'
      );
      console.log(`[Alert] 🔴 RED sent for ${groupId} (${mins} min)`);
    } else if (ageMs >= MIN15 && alertLevel === null) {
      setAlertLevel(groupId, 'yellow');
      await sendAlertCard(
        `🟡 แชทรอตอบ ${mins} นาที`,
        `**ข้อความล่าสุด:** ${preview}`,
        'yellow'
      );
      console.log(`[Alert] 🟡 YELLOW sent for ${groupId} (${mins} min)`);
    }
  }
}

// ─── Morning summary 07:45 ────────────────────────────────────────────────────
async function sendMorningSummary() {
  console.log('[Cron] 🌅 Morning summary...');
  const groups = getAllGroupsWithOffHours();
  if (!groups.length) {
    await sendAlertCard('🌅 สวัสดีตอนเช้า!', 'ไม่มีข้อความค้างจากนอกเวลางาน ✅', 'green');
    return;
  }
  for (const groupId of groups) {
    const msgs = flushOffHoursMessages(groupId);
    if (!msgs.length) continue;
    const summary = await summarizeForLark(msgs, groupId);
    const now = new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' });
    await sendAlertCard(
      `🌅 สรุปข้อความนอกเวลา — ${now}`,
      `**จำนวน:** ${msgs.length} ข้อความ\n\n${summary}`,
      'yellow'
    );
  }
}

// ─── Evening summary 17:45 ────────────────────────────────────────────────────
async function sendEveningSummary() {
  console.log('[Cron] 🌆 Evening summary...');
  const messages = flushMessages();
  const now = new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' });
  if (!messages.length) {
    await sendAlertCard('🌆 สรุปสิ้นวัน', `(${now})\n\nไม่มีงานค้างคืน ✅`, 'green');
    return;
  }
  const summary = await summarizeForLark(messages, 'end-of-day');
  await sendAlertCard(
    `🌆 สรุปสิ้นวัน — ${now}`,
    `**จำนวนข้อความ:** ${messages.length} รายการ\n\n${summary}`,
    'yellow'
  );
}

// ─── Bootstrap all crons ─────────────────────────────────────────────────────
function startCronJob() {
  cron.schedule('0 * * * *',    runPipeline,       { timezone: 'Asia/Bangkok' });
  cron.schedule('*/5 * * * *',  checkStaleChats,   { timezone: 'Asia/Bangkok' });
  cron.schedule('45 7 * * 1-5', sendMorningSummary,{ timezone: 'Asia/Bangkok' });
  cron.schedule('45 17 * * 1-5',sendEveningSummary,{ timezone: 'Asia/Bangkok' });
  console.log('[Cron] Jobs scheduled (Asia/Bangkok):');
  console.log('  :00/hr   → hourly pipeline');
  console.log('  */5 min  → stale-chat alert (🟡>15m 🔴>30m)');
  console.log('  07:45    → morning summary (Mon-Fri)');
  console.log('  17:45    → evening summary (Mon-Fri)');
}

module.exports = { startCronJob, runPipeline };
