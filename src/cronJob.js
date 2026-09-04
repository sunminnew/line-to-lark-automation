/**
 * cronJob.js
 * Scheduled jobs for the LINE<>Lark automation.
 *   - Hourly pipeline  : every hour during Bangkok business hours
 *   - Monday greeting  : 09:00 Monday BKK  (random image + message)
 *   - Friday greeting  : 17:50 Friday BKK  (random image + message + weather)
 */

const cron  = require('node-cron');
const axios = require('axios');
const { isBusinessHours, getBangkokTime } = require('./timeRouter');
const { flushMessages }     = require('./messageStore');
const { summarizeMessages } = require('./aiSummarizer');
const { createTasksInLark } = require('./larkIntegration');

const LINE_API = 'https://api.line.me/v2/bot';
const TOKEN    = () => process.env.LINE_CHANNEL_ACCESS_TOKEN;
const REPO_RAW = 'https://raw.githubusercontent.com/sunminnew/line-to-lark-automation/main/assets/';

// ── image pools ───────────────────────────────────────────────────────────────

const FRIDAY_IMAGES = [
  REPO_RAW + 'friday-1.png',
  REPO_RAW + 'friday-2.png',
  REPO_RAW + 'friday-3.png',
  REPO_RAW + 'friday-4.png',
];

const MONDAY_IMAGES = [
  REPO_RAW + 'monday-1.png',
  REPO_RAW + 'monday-2.png',
];

// ── message pools (Thai + Korean, no status/error text) ───────────────────────

const FRIDAY_TEXTS = [
  '🌸 Happy Friday!\n\nWISDOM INTERNATIONAL CONSULTING\n🌟 Have a wonderful weekend!\n🌟 즐거운 주말 보내세요!',
  '🌺 สุขสันต์วันศุกร์!\n\nWISDOM INTERNATIONAL CONSULTING\n✨ พักผ่อนให้เต็มที่นะคะ\n✨ 행복한 주말 되세요!',
  '🌼 Happy Friday!\n\nWISDOM INTERNATIONAL CONSULTING\n🙏 ขอบคุณทุกท่านสำหรับสัปดาห์นี้\n🙏 이번 주도 수고하셨습니다!',
  '🌻 สุขสันต์วันสิ้นสัปดาห์!\n\nWISDOM INTERNATIONAL CONSULTING\n💛 ขอให้มีความสุขมากๆ นะคะ\n💛 좋은 주말 보내세요!',
];

const MONDAY_TEXTS = [
  '🌞 Good Morning! Happy Monday!\n\nWISDOM INTERNATIONAL CONSULTING\n💼 새로운 한 주의 시작! 화이팅!\n💼 สัปดาห์ใหม่ที่ดี ขอให้ทุกท่านโชคดีนะคะ!',
  '☀️ สวัสดีวันจันทร์!\n\nWISDOM INTERNATIONAL CONSULTING\n🌱 เริ่มต้นสัปดาห์ใหม่อย่างสดชื่น\n🌱 활기찬 한 주 시작하세요!',
  '🌤 Happy Monday!\n\nWISDOM INTERNATIONAL CONSULTING\n⚡ พลังงานดีๆ สำหรับทุกท่าน\n⚡ 힘찬 월요일 되세요!',
];

// ── helpers ───────────────────────────────────────────────────────────────────

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

function getGroupIds() {
  return (process.env.LINE_GROUP_IDS ?? '')
    .split(',').map(s => s.trim()).filter(Boolean);
}

async function pushToGroup(groupId, messages) {
  try {
    await axios.post(
      LINE_API + '/message/push',
      { to: groupId, messages },
      { headers: { 'Content-Type': 'application/json',
                   Authorization: 'Bearer ' + TOKEN() } }
    );
    console.log('[Push] OK -> ' + groupId.slice(0, 12) + '...');
  } catch (err) {
    console.error('[Push] Error:', err.response?.data ?? err.message);
  }
}

async function pushImage(groupId, imageUrl) {
  await pushToGroup(groupId, [{
    type: 'image',
    originalContentUrl: imageUrl,
    previewImageUrl:    imageUrl,
  }]);
}

async function getBangkokWeekendWeather() {
  try {
    const res = await axios.get('https://wttr.in/Bangkok?format=j1', { timeout: 8000 });
    const w = res.data.weather;
    const desc = day => day.hourly[4]?.weatherDesc?.[0]?.value ?? 'Sunny';
    const emo  = d => d.includes('Rain') ? '☔' : d.includes('Cloud') ? '⛅' : '☀️';
    return {
      sat: { max: w[1].maxtempC, desc: desc(w[1]), emo: emo(desc(w[1])) },
      sun: { max: w[2].maxtempC, desc: desc(w[2]), emo: emo(desc(w[2])) },
    };
  } catch (e) {
    console.error('[Weather] Failed:', e.message);
    return null;
  }
}

// ── greetings ─────────────────────────────────────────────────────────────────

async function sendFridayGreeting() {
  const groups = getGroupIds();
  if (!groups.length) { console.log('[Friday] LINE_GROUP_IDS not set.'); return; }

  const imageUrl = pick(FRIDAY_IMAGES);
  let   text     = pick(FRIDAY_TEXTS);
  const wx       = await getBangkokWeekendWeather();

  if (wx) {
    text += '\n\n📍 Bangkok Weekend\n'
          + `Sat ${wx.sat.emo} ${wx.sat.desc} ${wx.sat.max}C\n`
          + `Sun ${wx.sun.emo} ${wx.sun.desc} ${wx.sun.max}C`;
  }

  for (const gid of groups) {
    await pushImage(gid, imageUrl);
    await pushToGroup(gid, [{ type: 'text', text }]);
  }
  console.log('[Friday] Sent image:', imageUrl.split('/').pop(), '| groups:', groups.length);
}

async function sendMondayGreeting() {
  const groups = getGroupIds();
  if (!groups.length) { console.log('[Monday] LINE_GROUP_IDS not set.'); return; }

  const imageUrl = pick(MONDAY_IMAGES);
  const text     = pick(MONDAY_TEXTS);

  for (const gid of groups) {
    await pushImage(gid, imageUrl);
    await pushToGroup(gid, [{ type: 'text', text }]);
  }
  console.log('[Monday] Sent image:', imageUrl.split('/').pop(), '| groups:', groups.length);
}

// ── hourly pipeline ───────────────────────────────────────────────────────────

async function runPipeline() {
  console.log('[Cron] Pipeline at', getBangkokTime(), '(Bangkok)');
  if (!isBusinessHours()) { console.log('[Cron] Outside hours — skip.'); return; }
  const messages = flushMessages();
  if (!messages.length) { console.log('[Cron] No messages.'); return; }
  const tasks = await summarizeMessages(messages);
  if (!tasks.length) { console.log('[Cron] No actionable tasks.'); return; }
  const ids = await createTasksInLark(tasks);
  console.log('[Cron] Created', ids.length, 'Lark task(s):', ids);
}

// ── scheduler ─────────────────────────────────────────────────────────────────

function startCronJob() {
  cron.schedule('0 * * * *',    runPipeline,         { timezone: 'Asia/Bangkok' });
  cron.schedule('0 9 * * 1',    sendMondayGreeting,  { timezone: 'Asia/Bangkok' });
  cron.schedule('50 17 * * 5',  sendFridayGreeting,  { timezone: 'Asia/Bangkok' });
  console.log('[Cron] Scheduled: hourly | Mon 09:00 | Fri 17:50 (Asia/Bangkok)');
}

module.exports = { startCronJob, runPipeline };
