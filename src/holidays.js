/**
 * holidays.js
 * Thai public holidays 2025-2026 + working-day helpers (Asia/Bangkok).
 */

const HOLIDAYS = new Set([
  // 2025
  '2025-01-01','2025-02-12','2025-04-06',
  '2025-04-13','2025-04-14','2025-04-15',
  '2025-05-01','2025-05-05','2025-05-12',
  '2025-06-03','2025-07-10','2025-07-11',
  '2025-08-12','2025-10-13','2025-10-23',
  '2025-12-05','2025-12-10','2025-12-31',
  // 2026
  '2026-01-01','2026-03-03','2026-04-06',
  '2026-04-13','2026-04-14','2026-04-15',
  '2026-05-01','2026-05-05','2026-05-31',
  '2026-06-03','2026-07-29','2026-07-30',
  '2026-08-12','2026-10-13','2026-10-23',
  '2026-12-05','2026-12-10','2026-12-31',
]);

function toDateKey(date) {
  return date.toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' }); // YYYY-MM-DD
}

function isHoliday(date) {
  return HOLIDAYS.has(toDateKey(date));
}

function isWeekend(date) {
  const bkk = new Date(date.toLocaleString('en-US', { timeZone: 'Asia/Bangkok' }));
  return bkk.getDay() === 0 || bkk.getDay() === 6;
}

function isWorkingDay(date) {
  return !isWeekend(date) && !isHoliday(date);
}

function nextWorkingDay(date) {
  const d = new Date(date);
  d.setDate(d.getDate() + 1);
  while (!isWorkingDay(d)) d.setDate(d.getDate() + 1);
  return d;
}

module.exports = { isHoliday, isWeekend, isWorkingDay, nextWorkingDay };
