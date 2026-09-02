/**
 * cronJob.js
 * Scheduled jobs for the LINE<>Lark automation.
 *
 * Jobs:
 *   - Hourly pipeline  : every hour during Bangkok business hours
 *   - Monday greeting  : 09:00 Monday BKK
 *   - Friday greeting  : 18:00 Friday BKK
 *   - Holiday reminder : 17:50 daily -- pushes to LINE if tomorrow is a Thai holiday
 */

const cron                               = require('node-cron');
const axios                              = require('axios');
const { isBusinessHours, getBangkokTime } = require('./timeRouter');
const { flushMessages }                  = require('./messageStore');
const { summarizeMessages }              = require('./aiSummarizer');
const { createTasksInLark }              = require('./larkIntegration');
const { getAllKnownGroupIds }            = require('./messageTracker');

// -- Thailand public holidays (YYYY-MM-DD, Bangkok time) -------------------
const THAI_HOLIDAYS = {
  '2026-01-01': 'วันปีใหม่',
  '2026-02-26': 'วันมาฆบูชา',
  '2026-04-06': 'วันจักรี',
  '2026-04-13': 'วันสงกรานต์',
  '2026-04-14': 'วันสงกรานต์',
  '2026-04-15': 'วันสงกรานต์',
  '2026-05-04': 'วันฉัตรมงคล',
  '2026-05-22': 'วันวิสาขบูชา',
  '2026-06-03': 'วันเฉลิมพระชนมพรรษาสมเด็จพระราชินี',
  '2026-07-28': 'วันเฉลิมพระชนมพรรษา ร.10',
  '2026-08-12': 'วันแม่แห่งชาติ',
  '2026-10-13': 'วันคล้ายวันสวรรคต ร.9',
  '2026-10-23': 'วันปิยมหาราช',
  '2026-12-05': 'วันชาติ',
  '2026-12-10': 'วันรัฐธรรมนูญ',
  '2026-12-31': 'วันสิ้นปี',
};

// -- LINE push helper -------------------------------------------------------
async function pushToLineGroup(groupId, text) {
  try {
    await axios.post(
      'https://api.line.me/v2/bot/message/push',
      { to: groupId, messages: [{ type: 'text', text }] },
      { headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}` } }
    );
    console.log(`[Cron] Push ok -> ${groupId.slice(0, 10)}`);
  } catch (e) {
    console.error(`[Cron] Push failed ${groupId.slice(0, 10)}: ${e.response ? e.response.status : e.message}`);
  }
}

// -- Hourly pipeline --------------------------------------------------------
async function runPipeline() {
  const localTime = getBangkokTime();
  console.log(`\n[Cron] Pipeline triggered at ${localTime} (Bangkok)`);

  if (!isBusinessHours()) {
    console.log('[Cron] Outside business hours -- skipping pipeline.');
    return;
  }

  const messages = flushMessages();
  if (messages.length === 0) {
    console.log('[Cron] No messages in store -- nothing to do.');
    return;
  }

  const tasks = await summarizeMessages(messages);
  if (tasks.length === 0) {
    console.log('[Cron] AI found no actionable tasks.');
    return;
  }

  const ids = await createTasksInLark(tasks);
  console.log(`[Cron] Created ${ids.length} Lark task(s):`, ids);
}

// -- Monday greeting (09:00 Mon) --------------------------------------------
async function sendMondayGreeting() {
  const groupIds = getAllKnownGroupIds();
  console.log(`[Cron] Monday greeting -> ${groupIds.length} group(s)`);
  if (!groupIds.length) return;
  const text = 'สวัสดีวันจันทร์! ขอให้ทุกคนมีสัปดาห์ที่ยอดเยี่ยมนะคะ\n월요일 좋은 한 주 되세요! 화이팅!';
  for (const gid of groupIds) await pushToLineGroup(gid, text);
}

// -- Friday greeting (18:00 Fri) --------------------------------------------
async function sendFridayGreeting() {
  const groupIds = getAllKnownGroupIds();
  console.log(`[Cron] Friday greeting -> ${groupIds.length} group(s)`);
  if (!groupIds.length) return;
  const text = 'สุขสันต์วันหยุดสุดสัปดาห์! ขอให้ทุกคนพักผ่อนอย่างมีความสุขนะคะ\n즐거운 주말 보내세요!';
  for (const gid of groupIds) await pushToLineGroup(gid, text);
}

// -- Holiday reminder (17:50 daily) -----------------------------------------
async function checkHolidayReminder() {
  const tomorrowBkk = new Date(Date.now() + 7 * 3600 * 1000 + 24 * 3600 * 1000);
  const yyyy = tomorrowBkk.getUTCFullYear();
  const mm   = String(tomorrowBkk.getUTCMonth() + 1).padStart(2, '0');
  const dd   = String(tomorrowBkk.getUTCDate()).padStart(2, '0');
  const tomorrowStr = `${yyyy}-${mm}-${dd}`;

  const holidayName = THAI_HOLIDAYS[tomorrowStr];
  if (!holidayName) {
    console.log(`[Cron] No holiday tomorrow (${tomorrowStr}) -- skip reminder.`);
    return;
  }

  const groupIds = getAllKnownGroupIds();
  console.log(`[Cron] Holiday reminder: ${holidayName} -> ${groupIds.length} group(s)`);
  if (!groupIds.length) return;

  const text = `พรุ่งนี้วันหยุด — ${holidayName}\nขอให้ทุกคนพักผ่อนอย่างมีความสุขนะคะ!\n내일은 휴일입니다 — ${holidayName}\n즐겁게 쉬세요!`;
  for (const gid of groupIds) await pushToLineGroup(gid, text);
}

// -- Start all schedules ----------------------------------------------------
function startCronJob() {
  cron.schedule('0 * * * *', runPipeline, { timezone: 'Asia/Bangkok' });
  cron.schedule('0 9 * * 1', sendMondayGreeting, { timezone: 'Asia/Bangkok' });
  cron.schedule('0 18 * * 5', sendFridayGreeting, { timezone: 'Asia/Bangkok' });
  cron.schedule('50 17 * * *', checkHolidayReminder, { timezone: 'Asia/Bangkok' });
  console.log('[Cron] Scheduled: hourly pipeline, Mon 09:00 greeting, Fri 18:00 greeting, daily 17:50 holiday check.');
}

module.exports = { startCronJob, runPipeline };
