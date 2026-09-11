/**
 * cronJob.js
 * Scheduled jobs for the LINE<>Lark automation.
 *
 * Jobs:
 * - Hourly pipeline  : every hour during Bangkok business hours
 * - Monday greeting  : 09:00 Mon BKK — image + message
 * - Friday farewell  : 18:00 Fri BKK — image + message
 * - Holiday reminder : 17:50 daily   — image + message if tomorrow is Thai holiday
 */

const cron = require('node-cron');
const axios = require('axios');
const { isBusinessHours, getBangkokTime } = require('./timeRouter');
const { flushMessages }    = require('./messageStore');
const { summarizeMessages } = require('./aiSummarizer');
const { createTasksInLark } = require('./larkIntegration');
const { getAllKnownGroupIds } = require('./messageTracker');
const { getHolidayName }   = require('./holidays');

// ── Image URLs ────────────────────────────────────────────────────────────────
const IMAGE_MONDAY  = 'https://i.ibb.co/Ldw6g4qn/cinematic-keyframe-1-5-A-bright-and-fresh-Monday-morning-concept-A-clean-modern-office-desk-wit.png';
const IMAGE_FRIDAY  = 'https://i.ibb.co/DgYXG22z/cinematic-keyframe-1-5-Photorealistic-photography-of-a-minimalist-cafe-table-in-Bangkok-at-sunset.png';
const IMAGE_HOLIDAY = 'https://i.ibb.co/q6j8vz4/cinematic-keyframe-1-5-A-luxurious-and-peaceful-tropical-resort-in-Thailand-A-beautiful-infinity.png';

// ── LINE push helper ──────────────────────────────────────────────────────────
async function pushToLineGroup(groupId, messages) {
  try {
    await axios.post(
      'https://api.line.me/v2/bot/message/push',
      { to: groupId, messages },
      {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`,
        },
        timeout: 5000,
      }
    );
    console.log(`[Cron] Push ok -> ${groupId.slice(0, 10)}`);
  } catch (e) {
    console.error(`[Cron] Push failed ${groupId.slice(0, 10)}: ${e.response ? e.response.status : e.message}`);
  }
}

// ── Weather helper ────────────────────────────────────────────────────────────
async function fetchWeather(city) {
  try {
    const r = await axios.get(`https://wttr.in/${city}?format=%t+%C`, {
      timeout: 5000,
      headers: { 'User-Agent': 'curl' },
    });
    return r.data.trim();
  } catch {
    return '';
  }
}

// ── Hourly pipeline ───────────────────────────────────────────────────────────
async function runPipeline() {
  const localTime = getBangkokTime();
  console.log(`\n[Cron] Pipeline triggered at ${localTime} (Bangkok)`);

  if (!isBusinessHours()) {
    console.log('[Cron] Outside business hours — skipping pipeline.');
    return;
  }

  const messages = flushMessages();
  if (messages.length === 0) {
    console.log('[Cron] No messages in store — nothing to do.');
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

// ── Monday greeting (09:00 Mon BKK) ──────────────────────────────────────────
async function sendMondayGreeting() {
  const groupIds = getAllKnownGroupIds();
  if (!groupIds.length) { console.log('[Cron] Monday greeting: no known groups'); return; }

  const [bkkW, seoW] = await Promise.all([fetchWeather('Bangkok'), fetchWeather('Seoul')]);
  const NL = '\n';
  const weatherLine = (bkkW || seoW)
    ? NL + NL +
      (bkkW ? `☀ Bangkok: ${bkkW}` : '') +
      (bkkW && seoW ? NL : '') +
      (seoW ? `☀ Seoul: ${seoW}` : '')
    : '';

  const text =
    'สวัสดีวันจันทร์ครับ หวังว่าทุกท่านพักผ่อนได้ดีนะครับ' + NL +
    'วันนี้เราพร้อมแล้ว ติดต่อได้เลยครับ 💼' + NL + NL +
    'Good morning. Wishing everyone a productive and pleasant week ahead. 🌟' + NL + NL +
    '새로운 한 주가 시작되었습니다. 🌟' + NL +
    '좋은 한 주 되시길 바랍니다.' +
    weatherLine;

  const messages = [
    { type: 'image', originalContentUrl: IMAGE_MONDAY, previewImageUrl: IMAGE_MONDAY },
    { type: 'text', text },
  ];

  console.log(`[Cron] Monday greeting -> ${groupIds.length} group(s)`);
  for (const gid of groupIds) await pushToLineGroup(gid, messages);
}

// ── Friday farewell (18:00 Fri BKK) ──────────────────────────────────────────
async function sendFridayGreeting() {
  const groupIds = getAllKnownGroupIds();
  if (!groupIds.length) { console.log('[Cron] Friday farewell: no known groups'); return; }

  const [bkkW, seoW] = await Promise.all([fetchWeather('Bangkok'), fetchWeather('Seoul')]);
  const NL = '\n';
  const weatherLine = (bkkW || seoW)
    ? NL + NL +
      (bkkW ? `☀ Bangkok: ${bkkW}` : '') +
      (bkkW && seoW ? NL : '') +
      (seoW ? `☀ Seoul: ${seoW}` : '')
    : '';

  const text =
    'ขอให้ทุกท่านมีวันหยุดสุดสัปดาห์ที่ดีนะครับ 😊' + NL + NL +
    'Wishing everyone a wonderful and restful weekend. 😊' + NL + NL +
    '이번 주도 수고 많으셨습니다. 🙏' + NL +
    '편안한 주말 되시길 바랍니다.' +
    weatherLine;

  const messages = [
    { type: 'image', originalContentUrl: IMAGE_FRIDAY, previewImageUrl: IMAGE_FRIDAY },
    { type: 'text', text },
  ];

  console.log(`[Cron] Friday farewell -> ${groupIds.length} group(s)`);
  for (const gid of groupIds) await pushToLineGroup(gid, messages);
}

// ── Holiday reminder (17:50 daily BKK) ───────────────────────────────────────
async function sendHolidayReminder() {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);

  const { th: nameTh, kr: nameKr } = getHolidayName(tomorrow);
  if (!nameTh) {
    console.log('[Cron] No holiday tomorrow — skip reminder.');
    return;
  }

  const groupIds = getAllKnownGroupIds();
  if (!groupIds.length) { console.log('[Cron] Holiday reminder: no known groups'); return; }

  const monthTH = ['','มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน','กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม'];
  const monthEN = ['','January','February','March','April','May','June','July','August','September','October','November','December'];
  const m = tomorrow.getMonth() + 1;
  const day = tomorrow.getDate();
  const krName = nameKr ? nameKr.split(' | ')[0] : nameTh;
  const NL = '\n';

  const text =
    `🌸 วันหยุดนักขัตฤกษ์ไทย — ${nameTh} 🌸${NL}${NL}` +
    `เรียนลูกค้าทุกท่านที่เคารพครับ 🙏${NL}${NL}` +
    `พรุ่งนี้ (${day} ${monthTH[m]}) ทางสำนักงานหยุดทำการเนื่องจากวัน "${nameTh}"${NL}` +
    `สามารถติดต่อทีมงานได้อีกครั้งในวันทำการถัดไปนะครับ${NL}` +
    `ขอบคุณทุกท่านที่ไว้วางใจในทีมงานของเราเสมอนะครับ 💙${NL}${NL}` +
    `———${NL}${NL}` +
    `🇹🇭 Thai Public Holiday — ${nameTh}${NL}` +
    `Our office will be closed tomorrow (${monthEN[m]} ${day}).${NL}` +
    `We'll be back on the next working day.${NL}` +
    `Thank you for your continued trust in us. 💙${NL}${NL}` +
    `———${NL}${NL}` +
    `🇰🇷 태국 공휴일 안내 — ${krName}${NL}` +
    `내일(${m}월 ${day}일)은 태국 공휴일입니다.${NL}` +
    `사무실은 휴무이며, 다음 영업일에 성심성의껏 연락드리겠습니다.${NL}` +
    `항상 믿어 주셔서 감사합니다 🙏`;

  const messages = [
    { type: 'image', originalContentUrl: IMAGE_HOLIDAY, previewImageUrl: IMAGE_HOLIDAY },
    { type: 'text', text },
  ];

  console.log(`[Cron] Holiday reminder: ${nameTh} -> ${groupIds.length} group(s)`);
  for (const gid of groupIds) await pushToLineGroup(gid, messages);
}

// ── Start all jobs ────────────────────────────────────────────────────────────
function startCronJob() {
  // Hourly pipeline
  cron.schedule('0 * * * *', runPipeline, { timezone: 'Asia/Bangkok' });
  // Monday 09:00 BKK
  cron.schedule('0 9 * * 1', sendMondayGreeting, { timezone: 'Asia/Bangkok' });
  // Friday 18:00 BKK
  cron.schedule('0 18 * * 5', sendFridayGreeting, { timezone: 'Asia/Bangkok' });
  // Daily 17:50 BKK — holiday check
  cron.schedule('50 17 * * *', sendHolidayReminder, { timezone: 'Asia/Bangkok' });

  console.log('[Cron] 4 jobs scheduled (Asia/Bangkok): hourly pipeline, Mon 09:00 greeting, Fri 18:00 farewell, daily 17:50 holiday check.');
}

module.exports = { startCronJob, runPipeline };
