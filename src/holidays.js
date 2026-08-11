/**
 * holidays.js
 * Thai public holidays 2025-2026 + working-day helpers (Asia/Bangkok).
 * Includes holiday name lookup for reminder notifications.
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

// Holiday names (TH / EN / KR) for notifications
const HOLIDAY_NAMES = {
  '2025-01-01': '\uC0C8\uD574 (\uC6D0\uB2E8) / \uC2E0\uC815 | \uC6D0\uB2E8 (\uD0DC\uAD6D)',
  '2025-02-12': '\uB9C8\uCB74\uBD80\uCC28 | Makha Bucha Day',
  '2025-04-06': '\uCC28\uD06C\uB9AC \uAE30\uB150\uC77C | Chakri Memorial Day',
  '2025-04-13': '\uC1A1\uD06C\uB780 \uCD95\uC81C | Songkran Festival',
  '2025-04-14': '\uC1A1\uD06C\uB780 \uCD95\uC81C | Songkran Festival',
  '2025-04-15': '\uC1A1\uD06C\uB780 \uCD95\uC81C | Songkran Festival',
  '2025-05-01': '\uB178\uB3D9\uC808 | National Labour Day',
  '2025-05-05': '\uB300\uAD00\uC2DD \uAE30\uB150\uC77C | Coronation Day',
  '2025-05-12': '\uBE44\uC0AC\uCE74\uBD80\uCC28 | Visakha Bucha Day',
  '2025-06-03': '\uD0DC\uAD6D \uC655\uBE44 \uC0DD\uC2E0 | Queen\'s Birthday',
  '2025-07-10': '\uC544\uC0B4\uB77C\uBD80\uCC28 | Asalha Bucha Day',
  '2025-07-11': '\uBD88\uAD50 \uC808\uAE30 (\uCE78\uC0AC) | Buddhist Lent Day',
  '2025-08-12': '\uC5B4\uBA38\uB2C8\uC758 \uB0A0 | Mother\'s Day (Queen\'s Birthday)',
  '2025-10-13': '\uB77C\uB9C8 9\uC138 \uAE30\uB150\uC77C | King Rama IX Memorial Day',
  '2025-10-23': '\uCD98\uB77C\uB860\uCF58 \uAE30\uB150\uC77C | Chulalongkorn Day',
  '2025-12-05': '\uC544\uBC84\uC9C0\uC758 \uB0A0 | Father\'s Day (Late King\'s Birthday)',
  '2025-12-10': '\uD5CC\uBC95\uAE30\uB150\uC77C | Constitution Day',
  '2025-12-31': '\uC5F0\uB9D0 | New Year\'s Eve',
  '2026-01-01': '\uC0C8\uD574 (\uC6D0\uB2E8) / \uC2E0\uC815 | \uC6D0\uB2E8 (\uD0DC\uAD6D)',
  '2026-03-03': '\uB9C8\uCB74\uBD80\uCC28 | Makha Bucha Day',
  '2026-04-06': '\uCC28\uD06C\uB9AC \uAE30\uB150\uC77C | Chakri Memorial Day',
  '2026-04-13': '\uC1A1\uD06C\uB780 \uCD95\uC81C | Songkran Festival',
  '2026-04-14': '\uC1A1\uD06C\uB780 \uCD95\uC81C | Songkran Festival',
  '2026-04-15': '\uC1A1\uD06C\uB780 \uCD95\uC81C | Songkran Festival',
  '2026-05-01': '\uB178\uB3D9\uC808 | National Labour Day',
  '2026-05-05': '\uB300\uAD00\uC2DD \uAE30\uB150\uC77C | Coronation Day',
  '2026-05-31': '\uBE44\uC0AC\uCE74\uBD80\uCC28 | Visakha Bucha Day',
  '2026-06-03': '\uD0DC\uAD6D \uC655\uBE44 \uC0DD\uC2E0 | Queen\'s Birthday',
  '2026-07-29': '\uC544\uC0B4\uB77C\uBD80\uCC28 | Asalha Bucha Day',
  '2026-07-30': '\uBD88\uAD50 \uC808\uAE30 (\uCE78\uC0AC) | Buddhist Lent Day',
  '2026-08-12': '\uC5B4\uBA38\uB2C8\uC758 \uB0A0 | Mother\'s Day (Queen\'s Birthday)',
  '2026-10-13': '\uB77C\uB9C8 9\uC138 \uAE30\uB150\uC77C | King Rama IX Memorial Day',
  '2026-10-23': '\uCD98\uB77C\uB860\uCF58 \uAE30\uB150\uC77C | Chulalongkorn Day',
  '2026-12-05': '\uC544\uBC84\uC9C0\uC758 \uB0A0 | Father\'s Day (Late King\'s Birthday)',
  '2026-12-10': '\uD5CC\uBC95\uAE30\uB150\uC77C | Constitution Day',
  '2026-12-31': '\uC5F0\uB9D0 | New Year\'s Eve',
};

// Thai-language holiday names for LINE messages
const HOLIDAY_NAMES_TH = {
  '2025-01-01': '\u0e27\u0e31\u0e19\u0e02\u0e36\u0e49\u0e19\u0e1b\u0e35\u0e43\u0e2b\u0e21\u0e48',
  '2025-02-12': '\u0e27\u0e31\u0e19\u0e21\u0e32\u0e06\u0e1a\u0e39\u0e0a\u0e32',
  '2025-04-06': '\u0e27\u0e31\u0e19\u0e08\u0e31\u0e01\u0e23\u0e35',
  '2025-04-13': '\u0e27\u0e31\u0e19\u0e2a\u0e07\u0e01\u0e23\u0e32\u0e19\u0e15\u0e4c',
  '2025-04-14': '\u0e27\u0e31\u0e19\u0e2a\u0e07\u0e01\u0e23\u0e32\u0e19\u0e15\u0e4c',
  '2025-04-15': '\u0e27\u0e31\u0e19\u0e2a\u0e07\u0e01\u0e23\u0e32\u0e19\u0e15\u0e4c',
  '2025-05-01': '\u0e27\u0e31\u0e19\u0e41\u0e23\u0e07\u0e07\u0e32\u0e19\u0e41\u0e2b\u0e48\u0e07\u0e0a\u0e32\u0e15\u0e34',
  '2025-05-05': '\u0e27\u0e31\u0e19\u0e09\u0e31\u0e15\u0e23\u0e21\u0e07\u0e04\u0e25',
  '2025-05-12': '\u0e27\u0e31\u0e19\u0e27\u0e34\u0e2a\u0e32\u0e02\u0e1a\u0e39\u0e0a\u0e32',
  '2025-06-03': '\u0e27\u0e31\u0e19\u0e40\u0e09\u0e25\u0e34\u0e21\u0e1e\u0e23\u0e30\u0e0a\u0e19\u0e21\u0e1e\u0e23\u0e23\u0e29\u0e32 \u0e2a\u0e21\u0e40\u0e14\u0e47\u0e08\u0e1e\u0e23\u0e30\u0e19\u0e32\u0e07\u0e40\u0e08\u0e49\u0e32\u0e23\u0e32\u0e0a\u0e34\u0e19\u0e35',
  '2025-07-10': '\u0e27\u0e31\u0e19\u0e2d\u0e32\u0e2a\u0e32\u0e2c\u0e2b\u0e1a\u0e39\u0e0a\u0e32',
  '2025-07-11': '\u0e27\u0e31\u0e19\u0e40\u0e02\u0e49\u0e32\u0e1e\u0e23\u0e23\u0e29\u0e32',
  '2025-08-12': '\u0e27\u0e31\u0e19\u0e41\u0e21\u0e48\u0e41\u0e2b\u0e48\u0e07\u0e0a\u0e32\u0e15\u0e34',
  '2025-10-13': '\u0e27\u0e31\u0e19\u0e04\u0e25\u0e49\u0e32\u0e22\u0e27\u0e31\u0e19\u0e2a\u0e27\u0e23\u0e23\u0e04\u0e15 \u0e23.9',
  '2025-10-23': '\u0e27\u0e31\u0e19\u0e1b\u0e34\u0e22\u0e21\u0e2b\u0e32\u0e23\u0e32\u0e0a',
  '2025-12-05': '\u0e27\u0e31\u0e19\u0e1e\u0e48\u0e2d\u0e41\u0e2b\u0e48\u0e07\u0e0a\u0e32\u0e15\u0e34',
  '2025-12-10': '\u0e27\u0e31\u0e19\u0e23\u0e31\u0e10\u0e18\u0e23\u0e23\u0e21\u0e19\u0e39\u0e0d',
  '2025-12-31': '\u0e27\u0e31\u0e19\u0e2a\u0e34\u0e49\u0e19\u0e1b\u0e35',
  '2026-01-01': '\u0e27\u0e31\u0e19\u0e02\u0e36\u0e49\u0e19\u0e1b\u0e35\u0e43\u0e2b\u0e21\u0e48',
  '2026-03-03': '\u0e27\u0e31\u0e19\u0e21\u0e32\u0e06\u0e1a\u0e39\u0e0a\u0e32',
  '2026-04-06': '\u0e27\u0e31\u0e19\u0e08\u0e31\u0e01\u0e23\u0e35',
  '2026-04-13': '\u0e27\u0e31\u0e19\u0e2a\u0e07\u0e01\u0e23\u0e32\u0e19\u0e15\u0e4c',
  '2026-04-14': '\u0e27\u0e31\u0e19\u0e2a\u0e07\u0e01\u0e23\u0e32\u0e19\u0e15\u0e4c',
  '2026-04-15': '\u0e27\u0e31\u0e19\u0e2a\u0e07\u0e01\u0e23\u0e32\u0e19\u0e15\u0e4c',
  '2026-05-01': '\u0e27\u0e31\u0e19\u0e41\u0e23\u0e07\u0e07\u0e32\u0e19\u0e41\u0e2b\u0e48\u0e07\u0e0a\u0e32\u0e15\u0e34',
  '2026-05-05': '\u0e27\u0e31\u0e19\u0e09\u0e31\u0e15\u0e23\u0e21\u0e07\u0e04\u0e25',
  '2026-05-31': '\u0e27\u0e31\u0e19\u0e27\u0e34\u0e2a\u0e32\u0e02\u0e1a\u0e39\u0e0a\u0e32',
  '2026-06-03': '\u0e27\u0e31\u0e19\u0e40\u0e09\u0e25\u0e34\u0e21\u0e1e\u0e23\u0e30\u0e0a\u0e19\u0e21\u0e1e\u0e23\u0e23\u0e29\u0e32 \u0e2a\u0e21\u0e40\u0e14\u0e47\u0e08\u0e1e\u0e23\u0e30\u0e19\u0e32\u0e07\u0e40\u0e08\u0e49\u0e32\u0e23\u0e32\u0e0a\u0e34\u0e19\u0e35',
  '2026-07-29': '\u0e27\u0e31\u0e19\u0e2d\u0e32\u0e2a\u0e32\u0e2c\u0e2b\u0e1a\u0e39\u0e0a\u0e32',
  '2026-07-30': '\u0e27\u0e31\u0e19\u0e40\u0e02\u0e49\u0e32\u0e1e\u0e23\u0e23\u0e29\u0e32',
  '2026-08-12': '\u0e27\u0e31\u0e19\u0e41\u0e21\u0e48\u0e41\u0e2b\u0e48\u0e07\u0e0a\u0e32\u0e15\u0e34',
  '2026-10-13': '\u0e27\u0e31\u0e19\u0e04\u0e25\u0e49\u0e32\u0e22\u0e27\u0e31\u0e19\u0e2a\u0e27\u0e23\u0e23\u0e04\u0e15 \u0e23.9',
  '2026-10-23': '\u0e27\u0e31\u0e19\u0e1b\u0e34\u0e22\u0e21\u0e2b\u0e32\u0e23\u0e32\u0e0a',
  '2026-12-05': '\u0e27\u0e31\u0e19\u0e1e\u0e48\u0e2d\u0e41\u0e2b\u0e48\u0e07\u0e0a\u0e32\u0e15\u0e34',
  '2026-12-10': '\u0e27\u0e31\u0e19\u0e23\u0e31\u0e10\u0e18\u0e23\u0e23\u0e21\u0e19\u0e39\u0e0d',
  '2026-12-31': '\u0e27\u0e31\u0e19\u0e2a\u0e34\u0e49\u0e19\u0e1b\u0e35',
};

function toDateKey(date) {
  return date.toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' }); // YYYY-MM-DD
}

function isHoliday(date) {
  return HOLIDAYS.has(toDateKey(date));
}

function getHolidayName(date) {
  const key = toDateKey(date);
  const nameTh = HOLIDAY_NAMES_TH[key] || null;
  const nameKr = HOLIDAY_NAMES[key] || null;
  return { th: nameTh, kr: nameKr, key };
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

module.exports = { isHoliday, isWeekend, isWorkingDay, nextWorkingDay, getHolidayName };
