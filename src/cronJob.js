/**
 * cronJob.js
 * Scheduled jobs for the LINE<>Lark automation.
 * Jobs:
 *   - Hourly pipeline  : every hour during Bangkok business hours
 *   - Monday greeting  : 09:00 Monday BKK
 *   - Friday greeting  : 17:50 Friday BKK (image + weather text)
 */

const cron  = require('node-cron');
const axios = require('axios');
const { isBusinessHours, getBangkokTime } = require('./timeRouter');
const { flushMessages }      = require('./messageStore');
const { summarizeMessages }  = require('./aiSummarizer');
const { createTasksInLark }  = require('./larkIntegration');

const LINE_API  = 'https://api.line.me/v2/bot';
const TOKEN     = () => process.env.LINE_CHANNEL_ACCESS_TOKEN;
const FRIDAY_IMAGE_URL =
  'https://raw.githubusercontent.com/sunminnew/line-to-lark-automation/main/assets/friday-greeting.png';

// helpers

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
    const res = await axios.get('https://wttr.in/Bangkok?format=j1',
                                { timeout: 8000 });
    const w   = res.data.weather;
    const sat = w[1];
    const sun = w[2];
    const desc = day => day.hourly[4]?.weatherDesc?.[0]?.value ?? 'Sunny';
    const emo  = d =>
      d.includes('Rain') ? '☔' : d.includes('Cloud') ? '⛅' : '☀️';
    return {
      sat: { max: sat.maxtempC, desc: desc(sat), emo: emo(desc(sat)) },
      sun: { max: sun.maxtempC, desc: desc(sun), emo: emo(desc(sun)) },
    };
  } catch (e) {
    console.error('[Weather] Failed:', e.message);
    return null;
  }
}

// greetings

async function sendFridayGreeting() {
  const groups = getGroupIds();
  if (!groups.length) {
    console.log('[Friday] LINE_GROUP_IDS not set — skipping.');
    return;
  }

  const wx = await getBangkokWeekendWeather();

  let textTH = '🌸 Happy Friday!\n\n'
    + 'WISDOM INTERNATIONAL CONSULTING\n'
    + '🌟 Have a wonderful weekend!\n'
    + '🌟 즐거운 주말 보내세요!';

  if (wx) {
    textTH +=
      '\n\n📍 Bangkok Weekend\n'
      + `Sat ${wx.sat.emo} ${wx.sat.desc} ${wx.sat.max}C\n`
      + `Sun ${wx.sun.emo} ${wx.sun.desc} ${wx.sun.max}C`;
  }

  for (const gid of groups) {
    await pushImage(gid, FRIDAY_IMAGE_URL);
    await pushToGroup(gid, [{ type: 'text', text: textTH }]);
  }
  console.log('[Friday] Greeting sent to', groups.length, 'group(s).');
}

async function sendMondayGreeting() {
  const groups = getGroupIds();
  if (!groups.length) {
    console.log('[Monday] LINE_GROUP_IDS not set — skipping.');
    return;
  }

  const text =
    '🌞 Good Morning! Happy Monday!\n\n'
    + 'WISDOM INTERNATIONAL CONSULTING\n'
    + '💼 새로운 한 주의 시작! 화이팅!\n'
    + '💼 สัปดาห์ใหม่ที่ดี ขอให้ทุกคนโชคดีนะคะ!';

  for (const gid of groups) {
    await pushToGroup(gid, [{ type: 'text', text }]);
  }
  console.log('[Monday] Greeting sent to', groups.length, 'group(s).');
}

// hourly pipeline

async function runPipeline() {
  const localTime = getBangkokTime();
  console.log('[Cron] Pipeline triggered at ' + localTime + ' (Bangkok)');

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
  console.log('[Cron] Created ' + ids.length + ' Lark task(s):', ids);
}

// scheduler

function startCronJob() {
  // Hourly pipeline
  cron.schedule('0 * * * *', runPipeline, { timezone: 'Asia/Bangkok' });

  // Monday 09:00 greeting
  cron.schedule('0 9 * * 1', sendMondayGreeting, { timezone: 'Asia/Bangkok' });

  // Friday 17:50 greeting (image + weather)
  cron.schedule('50 17 * * 5', sendFridayGreeting, { timezone: 'Asia/Bangkok' });

  console.log('[Cron] Scheduled: hourly pipeline | Mon 09:00 | Fri 17:50 (Asia/Bangkok)');
}

module.exports = { startCronJob, runPipeline };
