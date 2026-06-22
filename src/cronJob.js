/**
 * cronJob.js
 * Runs every hour (at :00) during Bangkok business hours.
 * Pipeline: flush store → AI summarize → create Lark tasks.
 *
 * node-cron docs: https://github.com/node-cron/node-cron
 * Cron expression "0 * * * *" = top of every hour, every day.
 */

const cron                        = require('node-cron');
const { isBusinessHours, getBangkokTime } = require('./timeRouter');
const { flushMessages }           = require('./messageStore');
const { summarizeMessages }       = require('./aiSummarizer');
const { createTasksInLark }       = require('./larkIntegration');

async function runPipeline() {
  const localTime = getBangkokTime();
  console.log(`\n[Cron] ⏰ Pipeline triggered at ${localTime} (Bangkok)`);

  if (!isBusinessHours()) {
    console.log('[Cron] Outside business hours — skipping pipeline.');
    return;
  }

  // 1. Fetch & clear the message buffer
  const messages = flushMessages();
  if (messages.length === 0) {
    console.log('[Cron] No messages in store — nothing to do.');
    return;
  }

  // 2. AI summarization
  const tasks = await summarizeMessages(messages);
  if (tasks.length === 0) {
    console.log('[Cron] AI found no actionable tasks.');
    return;
  }

  // 3. Create Lark tasks
  const ids = await createTasksInLark(tasks);
  console.log(`[Cron] ✅ Created ${ids.length} Lark task(s):`, ids);
}

/**
 * Schedules the hourly pipeline.
 * Call this once from server.js.
 */
function startCronJob() {
  // "0 * * * *" = minute 0 of every hour
  cron.schedule('0 * * * *', runPipeline, {
    timezone: 'Asia/Bangkok',
  });
  console.log('[Cron] Hourly pipeline scheduled (Asia/Bangkok timezone).');
}

module.exports = { startCronJob, runPipeline };
