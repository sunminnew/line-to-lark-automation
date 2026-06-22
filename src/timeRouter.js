/**
 * timeRouter.js
 * Determines whether the current moment is within Bangkok business hours.
 * Bangkok = Asia/Bangkok = UTC+7 (no DST).
 */

const TIMEZONE = 'Asia/Bangkok';
const START_HOUR = parseInt(process.env.BUSINESS_HOUR_START ?? '9', 10);
const END_HOUR   = parseInt(process.env.BUSINESS_HOUR_END   ?? '18', 10);

/**
 * Returns the current hour (0-23) in Bangkok time.
 */
function getBangkokHour() {
  const now = new Date();
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TIMEZONE,
    hour: 'numeric',
    hour12: false,
  }).formatToParts(now);
  return parseInt(parts.find(p => p.type === 'hour').value, 10);
}

/**
 * Returns a human-readable Bangkok datetime string.
 */
function getBangkokTime() {
  return new Date().toLocaleString('th-TH', { timeZone: TIMEZONE });
}

/**
 * @returns {boolean} true if NOW is within [09:00, 18:00) Bangkok time.
 */
function isBusinessHours() {
  const hour = getBangkokHour();
  return hour >= START_HOUR && hour < END_HOUR;
}

module.exports = { isBusinessHours, getBangkokHour, getBangkokTime };
