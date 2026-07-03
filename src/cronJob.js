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
const { isWorkingDay }     = require('./holidays');
const { flushMessages }    = require('./messageStore');
const {
  getStaleGroups, setAlertLevel,
  flushOffHoursMessages, getAllGroupsWithOffHours, getAllKnownGroupIds,
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
      'หมดสัปดาห์แล้วนะครับ 🌸',
      'ขอบคุณทุกคนที่ทำงานหนักมาตลอดสัปดาห์นะครับ',
      'พักผ่อนให้เต็มที่ แล้วพบกันใหม่วันจันทร์นะครับ',
      '',
      "That's a wrap for this week! 🎉",
      'Thank you all for the hard work.',
      "Enjoy your time off — you've earned it.",
      '',
      '한 주 동안 정말 수고 많으셨어요! 😊',
      '편안한 주말 보내시고, 월요일에 다시 만나요.',
    ].join(String.fromCharCode(10)) + weatherLine;
  } else {
    msg = [
      'สวัสดีวันจันทร์นะครับ 🌤️',
      'หวังว่าทุกคนพักผ่อนได้ดีนะครับ',
      'วันนี้เราเริ่มกันได้เลยนะครับ 💼',
      '',
      'Morning everyone! 🌟',
      'Hope you had a great weekend.',
      "Let's kick off a good week together.",
      '',
      '다들 주말 잘 쉬셨나요? 😊',
      '새로운 한 주도 함께 잘 해봐요 💪',
    ].join(String.fromCharCode(10)) + weatherLine;
  }
  for (const gid of groupIds) {
    await pushToLineGroup(gid, msg);
  }
}

// ─── Start ────────────────────────────────────────────────────────────────────
function startCronJob() {
  cron.schedule('0 * * * *',      runPipeline,        { timezone: 'Asia/Bangkok' });
  cron.schedule('*/5 * * * *',    checkStaleChats,    { timezone: 'Asia/Bangkok' });
  cron.schedule('30 8 * * 1-5',   sendMorningSummary, { timezone: 'Asia/Bangkok' });
  cron.schedule('45 17 * * 1-5',  sendEveningSummary, { timezone: 'Asia/Bangkok' });
  cron.schedule('0 18 * * 5', () => sendWeeklyGreeting('friday'), { timezone: 'Asia/Bangkok' });
    cron.schedule('0 9 * * 1', () => sendWeeklyGreeting('monday'), { timezone: 'Asia/Bangkok' });
    console.log('[CRON] 6 jobs started (BKK) — dailyLog + weekly greetings active');
  setTimeout(catchUpMorningSummary, 5000);
}

module.exports = { startCronJob, runPipeline };
