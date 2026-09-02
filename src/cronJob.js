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
  // Tomorrow in Bangkok time (UTC+7)
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
  // Hourly pipeline (top of every hour)
  cron.schedule('0 * * * *', runPipeline, { timezone: 'Asia/Bangkok' });

  // Monday 09:00 greeting
  cron.schedule('0 9 * * 1', sendMondayGreeting, { timezone: 'Asia/Bangkok' });

  // Friday 18:00 greeting
  cron.schedule('0 18 * * 5', sendFridayGreeting, { timezone: 'Asia/Bangkok' });

  // Daily 17:50 holiday reminder check
  cron.schedule('50 17 * * *', checkHolidayReminder, { timezone: 'Asia/Bangkok' });

  console.log('[Cron] Scheduled: hourly pipeline, Mon 09:00 greeting, Fri 18:00 greeting, daily 17:50 holiday check.');
}

module.exports = { startCronJob, runPipeline };/**
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
const axios = require('axios');
const groupNameCache = new Map();
async function getGroupName(groupId) {
  if (!groupId || groupId === 'unknown') return groupId;
  if (groupNameCache.has(groupId)) return groupNameCache.get(groupId);
  try {
    let url, nameKey;
    if (groupId.startsWith('C')) {
      url = 'https://api.line.me/v2/bot/group/' + groupId + '/summary';
      nameKey = 'groupName';
    } else if (groupId.startsWith('R')) {
      url = 'https://api.line.me/v2/bot/room/' + groupId + '/summary';
      nameKey = 'roomName';
    } else if (groupId.startsWith('U')) {
      url = 'https://api.line.me/v2/bot/profile/' + groupId;
      nameKey = 'displayName';
    } else {
      return groupId;
    }
    const r = await axios.get(url, {
      headers: { Authorization: 'Bearer ' + process.env.LINE_CHANNEL_ACCESS_TOKEN },
      timeout: 3000
    });
    const name = r.data[nameKey] || groupId;
    groupNameCache.set(groupId, name);
    return name;
  } catch { return groupId; }
}
const { isBusinessHours }  = require('./timeRouter');
const { isWorkingDay , getHolidayName }     = require('./holidays');
const { flushMessages }    = require('./messageStore');
const {
  getStaleGroups, setAlertLevel,
  flushOffHoursMessages, getAllGroupsWithOffHours, getAllKnownGroupIds,
  setPendingHolidayReminder,
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
  accumulateToDailyLog(messages);

  const now = new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' });

  // Group messages by groupName → send separate Lark message per group
  const byGroup = new Map();
  for (const msg of messages) {
    const key = msg.groupName || 'LINE';
    if (!byGroup.has(key)) byGroup.set(key, []);
    byGroup.get(key).push(msg);
  }

  for (const [groupName, msgs] of byGroup) {
    const summary = await summarizeForLark(msgs, 'pipeline');
    console.log('[CRON] pipeline: ' + msgs.length + ' msgs from ' + groupName + ' -> Lark');
    await sendToLarkGroup(
      [
        '📊 สรุปงาน LINE - ' + groupName + ' (' + now + ')',
        'จำนวนข้อความ: ' + msgs.length + ' รายการ',
        '',
        summary,
      ].join(String.fromCharCode(10))
    )
  }
}
// ─── Stale-chat check (every 5 min) ──────────────────────────────────────────
const MIN15 = 15 * 60 * 1000;
const MIN30 = 30 * 60 * 1000;

async function checkStaleChats() {
  if (!isBusinessHours()) return;
  const stale = getStaleGroups(MIN15);
  for (const { groupId, ageMs, lastSenderName, lastText, alertLevel } of stale) {
    const mins = Math.floor(ageMs / 60000);
    const groupName = await getGroupName(groupId);
    if (ageMs >= MIN30 && alertLevel !== 'red') {
      setAlertLevel(groupId, 'red');
      await sendStaleAlert(
        `🔴 แชทค้าง ${mins} นาที — ยังไม่มีใครตอบ!`,
        `**กลุ่ม:** ${groupName}\n**ข้อความล่าสุด:** ${lastSenderName}: ${lastText.slice(0,100)}\n\n⚠️ โปรดติดต่อลูกค้าด่วนที่สุด!`,
        'red'
      );
    } else if (ageMs >= MIN15 && alertLevel === null) {
      setAlertLevel(groupId, 'yellow');
      await sendStaleAlert(
        `🟡 แชทรอตอบ ${mins} นาที`,
        `**กลุ่ม:** ${groupName}\n**ข้อความล่าสุด:** ${lastSenderName}: ${lastText.slice(0,100)}`,
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
        `📩 **กลุ่ม:** ${msgs[0]?.groupName || groupId}\n📊 **จำนวน:** ${msgs.length} ข้อความ\n\n${summary}\n\n> ⚡ กรุณาวางแผนงานก่อนเริ่มงาน`
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
    `📊 **ข้อความทั้งวัน:** ${allMessages.length} รายการ\n\n${summary}\n\n> 🧠 วิเคราะห์โดย วิสดอม (위즈덤) AI 8 ชั้น · Wisdom International`
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

// ─── Weekly greeting helpers ────────────────────────────────────────────
async function fetchWeather(city) {
  try {
    const r = await axios.get('https://wttr.in/' + city + '?format=%t+%C', { timeout: 5000, headers: { 'User-Agent': 'curl' } });
    return r.data.trim();
  } catch { return ''; }
}

async function pushToLineGroup(groupId, text) {
  try {
    await axios.post('https://api.line.me/v2/bot/message/push', {
      to: groupId,
      messages: [{ type: 'text', text }]
    }, {
      headers: { Authorization: 'Bearer ' + process.env.LINE_CHANNEL_ACCESS_TOKEN, 'Content-Type': 'application/json' },
      timeout: 5000
    });
  } catch (e) { console.error('[CRON] push failed ' + groupId + ': ' + e.message); }
}

async function sendWeeklyGreeting(type) {
  const [bkkW, seoW] = await Promise.all([fetchWeather('Bangkok'), fetchWeather('Seoul')]);
  const weatherLine = (bkkW || seoW) ? (
    String.fromCharCode(10) + String.fromCharCode(10) +
    (bkkW ? String.fromCharCode(9728) + ' Bangkok: ' + bkkW : '') +
    (bkkW && seoW ? String.fromCharCode(10) : '') +
    (seoW ? String.fromCharCode(9728) + ' Seoul: ' + seoW : '')
  ) : '';
  const groupIds = getAllKnownGroupIds();
  if (!groupIds.length) { console.log('[CRON] weekly greeting: no known groups'); return; }
  console.log('[CRON] weekly greeting (' + type + '): sending to ' + groupIds.length + ' groups');
  let msg;
  if (type === 'friday') {
    msg = [
      'ขอให้ทุกท่านมีวันหยุดสุดสัปดาห์ที่ดีนะครับ 😊',
      '',
      'Wishing everyone a wonderful and restful weekend. 😊',
      '',
      '이번 주도 수고 많으셨습니다. 🙏',
      '편안한 주말 되시길 바랍니다.',
    ].join(String.fromCharCode(10)) + weatherLine;
  } else {
    msg = [
      'สวัสดีวันจันทร์ครับ หวังว่าทุกท่านพักผ่อนได้ดีนะครับ',
      'วันนี้เราพร้อมแล้ว ติดต่อได้เลยครับ 💼',
      '',
      'Good morning. Wishing everyone a productive and pleasant week ahead. 🌟',
      '',
      '새로운 한 주가 시작되었습니다. 🌟',
      '좋은 한 주 되시길 바랍니다.',
    ].join(String.fromCharCode(10)) + weatherLine;
  }
  for (const gid of groupIds) {
    await pushToLineGroup(gid, msg);
  }
}


// ─── Holiday reminder (17:00 daily) ──────────────────────────────────────────

// ─── Start ────────────────────────────────────────────────────────────────────

// ─── Holiday reminder (17:00 daily) ─────────────────────────────────────────
async function sendHolidayReminder() {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const { th: nameTh, kr: nameKr, key } = getHolidayName(tomorrow);
  if (!nameTh) return; // tomorrow is not a Thai holiday

  const d = tomorrow;
  const dayNum = d.toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' }).slice(8); // DD
  const monthTH = ['', 'มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน','กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม'];
  const monthEN = ['','January','February','March','April','May','June','July','August','September','October','November','December'];
  const monthKR = ['','일월','이월','삼월','사월','오월','유월','칠월','팔월','구월','십월','십일월','십이월'];
  const m = d.toLocaleDateString('en-US', { timeZone: 'Asia/Bangkok', month: 'numeric' }) * 1;
  const day = parseInt(dayNum);

  const krName = nameKr ? nameKr.split(' | ')[0] : nameTh;
  const NL = '\n';

  const msg =
    '🌸 วันหยุดนักขัตฤกษ์ไทย — ' + nameTh + ' 🌸' + NL +
    NL +
    'เรียนลูกค้าทุกท่านที่เคารพครับ 🙏' + NL +
    NL +
    'พรุ่งนี้ (' + day + ' ' + monthTH[m] + ') ทางสำนักงานหยุดทำการเนื่องจากวัน “' + nameTh + '”' + NL +
    'สามารถติดต่อทีมงานได้อีกครั้งในวันทำการถัดไปนะครับ' + NL +
    'ขอบคุณทุกท่านที่ไว้วางใจในทีมงานของเราเสมอนะครับ 💙' + NL +
    NL +
    '———' + NL +
    NL +
    '🇹🇭 Thai Public Holiday — ' + nameTh + NL +
    'Our office will be closed tomorrow (' + monthEN[m] + ' ' + day + ').' + NL +
    'We’ll be back on the next working day.' + NL +
    'Thank you for your continued trust in us. 💙' + NL +
    NL +
    '———' + NL +
    NL +
    '🇰🇷 태국 공휴일 안내 — ' + krName + NL +
    '내일(' + m + '월 ' + day + '일)은 태국 공휴일입니다.' + NL +
    '사무실은 휴무이며, 다음 영업일에 성심성의껴 연락드리겠습니다.' + NL +
    '항상 믿어 주셔서 감사합니다 🙏';

  setPendingHolidayReminder(msg);
  console.log('[CRON] holiday reminder set as pending: ' + nameTh + ' → piggyback on next reply');
}
function startCronJob() {
  cron.schedule('0 * * * *',      runPipeline,        { timezone: 'Asia/Bangkok' });
  cron.schedule('*/5 * * * *',    checkStaleChats,    { timezone: 'Asia/Bangkok' });
  cron.schedule('30 8 * * 1-5',   sendMorningSummary, { timezone: 'Asia/Bangkok' });
  cron.schedule('45 17 * * 1-5',  sendEveningSummary, { timezone: 'Asia/Bangkok' });
  cron.schedule('0 18 * * 5', () => sendWeeklyGreeting('friday'), { timezone: 'Asia/Bangkok' });
    cron.schedule('0 9 * * 1', () => sendWeeklyGreeting('monday'), { timezone: 'Asia/Bangkok' });
  cron.schedule('50 17 * * *', sendHolidayReminder, { timezone: 'Asia/Bangkok' });
    console.log('[CRON] 7 jobs started (BKK) — dailyLog + weekly greetings + holiday reminder active');
  setTimeout(catchUpMorningSummary, 5000);
}

module.exports = { startCronJob, runPipeline };
