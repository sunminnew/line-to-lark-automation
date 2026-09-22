/**
 * cronJob.js
 * Scheduled jobs for the LINE<>Lark automation.
 *
 * Jobs:
 *   - Hourly pipeline    : every hour during Bangkok business hours
 *   - Daily morning      : 08:55 Mon-Fri BKK -- weather + greeting (varies by day)
 *   - Daily evening      : 17:50 Mon-Fri BKK -- weather + farewell (varies by day)
 *   - Monday greeting    : 09:00 Mon BKK -- image + special weekly message
 *   - Friday farewell    : 18:00 Fri BKK -- image + special weekly message
 *   - Holiday reminder   : 17:50 daily -- image + message if tomorrow is Thai holiday
 */

const cron = require('node-cron');
const axios = require('axios');
const { isBusinessHours, getBangkokTime } = require('./timeRouter');
const { flushMessages }                   = require('./messageStore');
const { summarizeMessages }               = require('./aiSummarizer');
const { createTasksInLark }               = require('./larkIntegration');
const { getAllKnownGroupIds }             = require('./messageTracker');
const { getHolidayName }                  = require('./holidays');

const IMAGE_MONDAY  = 'https://i.ibb.co/Ldw6g4qn/cinematic-keyframe-1-5-A-bright-and-fresh-Monday-morning-concept-A-clean-modern-office-desk-wit.png';
const IMAGE_FRIDAY  = 'https://i.ibb.co/DgYXG22z/cinematic-keyframe-1-5-Photorealistic-photography-of-a-minimalist-cafe-table-in-Bangkok-at-sunset.png';
const IMAGE_HOLIDAY = 'https://i.ibb.co/q6j8vz4/cinematic-keyframe-1-5-A-luxurious-and-peaceful-tropical-resort-in-Thailand-A-beautiful-infinity.png';

async function pushToLineGroup(groupId, messages) {
  try {
    await axios.post(
      'https://api.line.me/v2/bot/message/push',
      { to: groupId, messages },
      { headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}` }, timeout: 5000 }
    );
    console.log(`[Cron] Push ok -> ${groupId.slice(0, 10)}`);
  } catch (e) {
    console.error(`[Cron] Push failed ${groupId.slice(0, 10)}: ${e.response ? e.response.status : e.message}`);
  }
}

async function fetchWeather(city) {
  try {
    const r = await axios.get(`https://wttr.in/${city}?format=%t+%C`, { timeout: 5000, headers: { 'User-Agent': 'curl' } });
    return r.data.trim();
  } catch { return ''; }
}

function bkkDow() {
  const d = new Date(Date.now() + 7 * 3600 * 1000).getUTCDay();
  return d === 0 ? 7 : d;
}

function wl(bkk, seo, lang) {
  if (!bkk && !seo) return '';
  const parts = lang === 'th'
    ? [bkk ? `กรุงเทพ: ${bkk}` : '', seo ? `โซล: ${seo}` : '']
    : [bkk ? `방콕: ${bkk}` : '', seo ? `서울: ${seo}` : ''];
  return '\n' + parts.filter(Boolean).join(' | ');
}

const MORNING = {
  1: (b, s) => `🌅 สวัสดีตอนเช้าวันจันทร์นะคะ!\nต้อนรับสัปดาห์ใหม่ด้วยพลังงานดีๆ ค่ะ\nขอให้ทุกท่านมีวันที่สดใสและประสบความสำเร็จนะคะ${wl(b,s,'th')}\n\n🌅 월요일 아침이에요!\n새로운 한 주의 시작, 힘차게 시작해 봐요!\n오늘도 좋은 하루 되세요${wl(b,s,'kr')}`,
  2: (b, s) => `🌤 สวัสดีตอนเช้าวันอังคารค่ะ!\nเมื่อวานทำได้ยอดเยี่ยมมากเลยนะคะ วันนี้ยังดีกว่าแน่นอนค่ะ\nขอให้มีพลังงานเต็มเปี่ยมตลอดวันนะคะ${wl(b,s,'th')}\n\n🌤 화요일 아침이에요!\n어제도 수고 많으셨어요! 오늘도 더 좋은 하루 만들어 봐요!\n즐겁고 활기찬 하루 보내세요${wl(b,s,'kr')}`,
  3: (b, s) => `☀ สวัสดีตอนเช้าวันพุธค่ะ!\nผ่านมาครึ่งสัปดาห์แล้วนะคะ เก่งมากเลยค่ะ!\nขอให้มีพลังงานดีๆ และรอยยิ้มสวยๆ ตลอดวันนะคะ${wl(b,s,'th')}\n\n☀ 수요일 아침이에요!\n이번 주의 절반이나 왔어요! 고생하셨어요\n오늘도 행복하고 보람찬 하루 되세요${wl(b,s,'kr')}`,
  4: (b, s) => `🌈 สวัสดีตอนเช้าวันพฤหัสบดีค่ะ!\nเกือบถึงสุดสัปดาห์แล้วนะคะ อีกนิดเดียวก็จะถึงวันหยุดนะคะ${wl(b,s,'th')}\n\n🌈 l��일 아침이에요!\n주의말이 언맄 안 았어요!\n오늘도 행복하고 보람찬 하루 되세요${wl(b,s,'kr')}`,
  5: (b, s) => `🎉 สวัสดีตอนเช้าวันศุกร์ค่ะ!\nวันสุดท้ายของสัปดาห์แล้วนะคะ ยินดีด้วยค่ะ!\nขอให้ทุกท่านมีวันที่ดีที่สุดแห่งสัปดาห์นะคะ${wl(b,s,'th')}\n\n🎉 금요일 아침이에요!\n드디어 금요이! 오늘도 힘차게 마무리해요!\n즐겁고 활기찬 하루 되세요${wl(b,s,'kr')}`,
};

const EVENING = {
  1: (b, s) => `🌇 ใกล้เวลาเลิกงานแล้วนะคะ!\nวันแรกของสัปดาห์ผ่านไปได้ด้วยดีนะคะ ทำได้ดีมากเลยค่ะ\nขอให้เดินทางกลับบ้านอย่างปลอดภัยและพักผ่อนได้อย่างมีความสุขนะคะ${wl(b,s,'th')}\n\n🌇 퇴근 시간이 다가왔어요!\n월요일 하루도 정말 수고 많으셨어요!\n안전하게 귀가하시고 편안한 저녁 보내세요${wl(b,s,'kr')}`,
  2: (b, s) => `🌆 เวลาพักผ่อนใกล้จะมาถึงแล้วนะคะ!\nวันนี้ท่านทำได้ยอดเยี่ยมมากเลยค่ะ ขอชื่นชมทุกท่านค่ะ\nขอให้ได้พักผ่อนและฟื้นฟูพลังงานสำหรับวันพรุ่งนี้นะคะ${wl(b,s,'th')}\n\n🌆 이제 퇴근 시간이에요!\n오늘도 정말 수고하셨어요!\n충분히 쉬시고 내일도 화이팅하세요${wl(b,s,'kr')}`,
  3: (b, s) => `🌅 ผ่านครึ่งสัปดาห์มาแล้วนะคะ ยอดเยี่ยมมากเลยค่ะ!\nวันนี้ทำได้ดีมาก ขอบคุณทุกท่านที่ไว้วางใจทีมงานของเรานะคะ\nขอให้พักผ่อนได้อย่างมีความสุขนะคะ${wl(b,s,'th')}\n\n🌅 수요일도 잘 마무리했어요!\n한 주의 절반을 잘 해내셨습니다! 오늘도 정말 고생하셨어요\n편안한 저녁 보내세요${wl(b,s,'kr')}`,
  4: (b, s) => `🌃 วันนี้ผ่านไปด้วยดีนะคะ!\nอีกแค่วันเดียวก็จะถึงวันหยุดสุดสัปดาห์แล้วนะคะ สู้ๆ ค่ะ!\nขอให้กลับบ้านอย่างปลอดภัยและนอนหลับพักผ่อนให้เต็มที่นะคะ${wl(b,s,'th')}\n\n🌃 목요일 하루도 수고하셨어요!\n내일이면 주말이에요! 조금만 더 힘내세요!\n안전하게 집에 가시고 푹 쉬세요${wl(b,s,'kr')}`,
  5: (b, s) => `✨ ยินดีด้วยนะคะ! ผ่านสัปดาห์นี้มาได้เรียบร้อยแล้วค่ะ!\nขอบคุณทุกท่านมากๆ ที่ไว้วางใจทีมงานของเราเสมอนะครับ${wl(b,s,'th')}\n\n✨ 이번 주도 정말 수고 많으셨어요!\n항상 저희를 믿어 주셔서 진심으로 감사합니다!\n행복하고 편안한 주말 보내세요${wl(b,s,'kr')}`,
};

async function runPipeline() {
  const localTime = getBangkokTime();
  console.log(`\n[Cron] Pipeline triggered at ${localTime} (Bangkok)`);
  if (!isBusinessHours()) { console.log('[Cron] Outside business hours -- skipping pipeline.'); return; }
  const messages = flushMessages();
  if (messages.length === 0) { console.log('[Cron] No messages in store -- nothing to do.'); return; }
  const tasks = await summarizeMessages(messages);
  if (tasks.length === 0) { console.log('[Cron] AI found no actionable tasks.'); return; }
  const ids = await createTasksInLark(tasks);
  console.log(`[Cron] Created ${ids.length} Lark task(s):`, ids);
}

async function sendDailyMorning() {
  const groupIds = getAllKnownGroupIds();
  if (!groupIds.length) { console.log('[Cron] Morning: no known groups'); return; }
  const dow = bkkDow();
  const fn = MORNING[dow];
  if (!fn) return;
  const [b, s] = await Promise.all([fetchWeather('Bangkok'), fetchWeather('Seoul')]);
  const text = fn(b, s);
  console.log(`[Cron] Daily morning dow=${dow} BKK:${b} SEO:${s} -> ${groupIds.length} group(s)`);
  for (const gid of groupIds) await pushToLineGroup(gid, [{ type: 'text', text }]);
}

async function sendDailyEvening() {
  const groupIds = getAllKnownGroupIds();
  if (!groupIds.length) { console.log('[Cron] Evening: no known groups'); return; }
  const dow = bkkDow();
  const fn = EVENING[dow];
  if (!fn) return;
  const [b, s] = await Promise.all([fetchWeather('Bangkok'), fetchWeather('Seoul')]);
  const text = fn(b, s);
  console.log(`[Cron] Daily evening dow=${dow} BKK:${b} SEO:${s} -> ${groupIds.length} group(s)`);
  for (const gid of groupIds) await pushToLineGroup(gid, [{ type: 'text', text }]);
}

async function sendMondayGreeting() {
  const groupIds = getAllKnownGroupIds();
  if (!groupIds.length) { console.log('[Cron] Monday greeting: no known groups'); return; }
  const [bkkW, seoW] = await Promise.all([fetchWeather('Bangkok'), fetchWeather('Seoul')]);
  const NL = '\n';
  const weather = (bkkW || seoW) ? NL + NL + (bkkW ? `☀ Bangkok: ${bkkW}` : '') + (bkkW && seoW ? NL : '') + (seoW ? `☀ Seoul: ${seoW}` : '') : '';
  const text = 'สวัสดีวันจันทร์ครับ หวังว่าทุกท่านพักผ่อนได้ดีนะครับ' + NL + 'วันนี้เราพร้อมแล้ว ติดต่อได้เลยครับ' + NL + NL + 'Good morning. Wishing everyone a productive and pleasant week ahead.' + NL + NL + '새로운 한 주가 시작되었습니다.' + NL + '좋은 한 주 되시길 바랍니다.' + weather;
  const msgs = [{ type: 'image', originalContentUrl: IMAGE_MONDAY, previewImageUrl: IMAGE_MONDAY }, { type: 'text', text }];
  console.log(`[Cron] Monday greeting -> ${groupIds.length} group(s)`);
  for (const gid of groupIds) await pushToLineGroup(gid, msgs);
}

async function sendFridayGreeting() {
  const groupIds = getAllKnownGroupIds();
  if (!groupIds.length) { console.log('[Cron] Friday farewell: no known groups'); return; }
  const [bkkW, seoW] = await Promise.all([fetchWeather('Bangkok'), fetchWeather('Seoul')]);
  const NL = '\n';
  const weather = (bkkW || seoW) ? NL + NL + (bkkW ? `☀ Bangkok: ${bkkW}` : '') + (bkkW && seoW ? NL : '') + (seoW ? `☀ Seoul: ${seoW}` : '') : '';
  const text = 'ขอให้ทุกท่านมีวันหยุดสุดสัปดาห์ที่ดีนะครับ' + NL + NL + 'Wishing everyone a wonderful and restful weekend.' + NL + NL + '이번 주도 수고 많으셨습니다.' + NL + '편안한 주말 되시길 바랍니다.' + weather;
  const msgs = [{ type: 'image', originalContentUrl: IMAGE_FRIDAY, previewImageUrl: IMAGE_FRIDAY }, { type: 'text', text }];
  console.log(`[Cron] Friday farewell -> ${groupIds.length} group(s)`);
  for (const gid of groupIds) await pushToLineGroup(gid, msgs);
}

async function sendHolidayReminder() {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const { th: nameTh, kr: nameKr } = getHolidayName(tomorrow);
  if (!nameTh) { console.log('[Cron] No holiday tomorrow -- skip reminder.'); return; }
  const groupIds = getAllKnownGroupIds();
  if (!groupIds.length) { console.log('[Cron] Holiday reminder: no known groups'); return; }
  const monthTH = ['','มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน','กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม'];
  const monthEN = ['','January','February','March','April','May','June','July','August','September','October','November','December'];
  const m = tomorrow.getMonth() + 1;
  const day = tomorrow.getDate();
  const krName = nameKr ? nameKr.split(' | ')[0] : nameTh;
  const NL = '\n';
  const text = `🌸 วันหยุดนักขัตฤกษ์ไทย -- ${nameTh} 🌸${NL}${NL}เรียนลูกค้าทุกท่านที่เคารพครับ${NL}${NL}พรุ่งนี้ (${day} ${monthTH[m]}) ทางสำนักงานหยุดทำการเนื่องจากวัน "${nameTh}"${NL}สามารถติดต่อทีมงานได้อีกครั้งในวันทำการถัดไปนะครับ${NL}ขอบคุณทุกท่านที่ไว้วางใจในทีมงานของเราเสมอนะครับ${NL}${NL}———${NL}${NL}🇹🇭 Thai Public Holiday -- ${nameTh}${NL}Our office will be closed tomorrow (${monthEN[m]} ${day}).${NL}We'll be back on the next working day.${NL}Thank you for your continued trust in us.${NL}${NL}———${NL}${NL}🇰🇷 태국 공휴일 안내 -- ${krName}${NL}내일(${m}월 ${day}일)은 태국 공휴일입니다.${NL}사무실은 휴무이며, 다음 영업일에 성심성의껏 연락드리겠습니다.${NL}항상 믿어 주셔서 감사합니다`;
  const msgs = [{ type: 'image', originalContentUrl: IMAGE_HOLIDAY, previewImageUrl: IMAGE_HOLIDAY }, { type: 'text', text }];
  console.log(`[Cron] Holiday reminder: ${nameTh} -> ${groupIds.length} group(s)`);
  for (const gid of groupIds) await pushToLineGroup(gid, msgs);
}

function startCronJob() {
  cron.schedule('0 * * * *',    runPipeline,         { timezone: 'Asia/Bangkok' });
  cron.schedule('55 8 * * 1-5', sendDailyMorning,   { timezone: 'Asia/Bangkok' });
  cron.schedule('50 17 * * 1-5',sendDailyEvening,   { timezone: 'Asia/Bangkok' });
  cron.schedule('0 9 * * 1',    sendMondayGreeting,  { timezone: 'Asia/Bangkok' });
  cron.schedule('0 18 * * 5',   sendFridayGreeting,  { timezone: 'Asia/Bangkok' });
  cron.schedule('50 17 * * *',  sendHolidayReminder, { timezone: 'Asia/Bangkok' });
  console.log('[Cron] 6 jobs scheduled (Asia/Bangkok): hourly pipeline | 08:55 Mon-Fri morning | 17:50 Mon-Fri evening | Mon 09:00 greeting | Fri 18:00 farewell | daily 17:50 holiday check.');
}

module.exports = { startCronJob, runPipeline };
