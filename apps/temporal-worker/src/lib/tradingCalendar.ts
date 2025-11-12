/**
 * Trading calendar utilities for US markets.
 * Handles business days, quarter-end detection, and EOW (end-of-window) logic.
 */

/**
 * US Federal holidays that affect NYSE trading (fixed dates).
 * Markets are closed on these dates.
 */
const FIXED_HOLIDAYS = [
  '01-01', // New Year's Day
  '07-04', // Independence Day
  '12-25', // Christmas
];

/**
 * Calculate variable US market holidays for a given year.
 * Returns Map of date string (MM-DD) to holiday name.
 */
function getVariableHolidays(year: number): Map<string, string> {
  const holidays = new Map<string, string>();

  // Martin Luther King Jr. Day - 3rd Monday in January
  const mlkDay = getNthWeekdayOfMonth(year, 0, 1, 3);
  holidays.set(formatMonthDay(mlkDay), 'MLK Day');

  // Presidents Day - 3rd Monday in February
  const presidentsDay = getNthWeekdayOfMonth(year, 1, 1, 3);
  holidays.set(formatMonthDay(presidentsDay), 'Presidents Day');

  // Good Friday - Friday before Easter
  const goodFriday = getGoodFriday(year);
  holidays.set(formatMonthDay(goodFriday), 'Good Friday');

  // Memorial Day - Last Monday in May
  const memorialDay = getLastWeekdayOfMonth(year, 4, 1);
  holidays.set(formatMonthDay(memorialDay), 'Memorial Day');

  // Juneteenth - June 19 (observed since 2021)
  if (year >= 2021) {
    let juneteenth = new Date(Date.UTC(year, 5, 19));
    // If Saturday, observe on Friday; if Sunday, observe on Monday
    if (juneteenth.getUTCDay() === 6) {
      juneteenth.setUTCDate(18);
    } else if (juneteenth.getUTCDay() === 0) {
      juneteenth.setUTCDate(20);
    }
    holidays.set(formatMonthDay(juneteenth), 'Juneteenth');
  }

  // Labor Day - 1st Monday in September
  const laborDay = getNthWeekdayOfMonth(year, 8, 1, 1);
  holidays.set(formatMonthDay(laborDay), 'Labor Day');

  // Thanksgiving - 4th Thursday in November
  const thanksgiving = getNthWeekdayOfMonth(year, 10, 4, 4);
  holidays.set(formatMonthDay(thanksgiving), 'Thanksgiving');

  return holidays;
}

/**
 * Get the Nth occurrence of a weekday in a month.
 * @param year - Year
 * @param month - Month (0-11)
 * @param weekday - Day of week (0=Sunday, 1=Monday, ..., 6=Saturday)
 * @param n - Which occurrence (1=first, 2=second, etc.)
 */
function getNthWeekdayOfMonth(year: number, month: number, weekday: number, n: number): Date {
  const firstDay = new Date(Date.UTC(year, month, 1));
  const firstWeekday = firstDay.getUTCDay();

  // Calculate days until the first occurrence of the target weekday
  let daysUntilWeekday = (weekday - firstWeekday + 7) % 7;

  // Calculate the date of the Nth occurrence
  const date = 1 + daysUntilWeekday + (n - 1) * 7;

  return new Date(Date.UTC(year, month, date));
}

/**
 * Get the last occurrence of a weekday in a month.
 * @param year - Year
 * @param month - Month (0-11)
 * @param weekday - Day of week (0=Sunday, 1=Monday, ..., 6=Saturday)
 */
function getLastWeekdayOfMonth(year: number, month: number, weekday: number): Date {
  // Start from the last day of the month and work backwards
  const lastDay = new Date(Date.UTC(year, month + 1, 0));
  const lastDayWeekday = lastDay.getUTCDay();

  // Calculate days to subtract to get to the target weekday
  const daysBack = (lastDayWeekday - weekday + 7) % 7;

  return new Date(Date.UTC(year, month, lastDay.getUTCDate() - daysBack));
}

/**
 * Calculate Good Friday for a given year using the Computus algorithm.
 * Good Friday is 2 days before Easter Sunday.
 */
function getGoodFriday(year: number): Date {
  const easter = getEasterSunday(year);
  const goodFriday = new Date(easter);
  goodFriday.setUTCDate(easter.getUTCDate() - 2);
  return goodFriday;
}

/**
 * Calculate Easter Sunday using the Anonymous Gregorian algorithm.
 */
function getEasterSunday(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31) - 1; // 0-indexed
  const day = ((h + l - 7 * m + 114) % 31) + 1;

  return new Date(Date.UTC(year, month, day));
}

/**
 * Format a date as MM-DD string.
 */
function formatMonthDay(date: Date): string {
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${month}-${day}`;
}

// Cache for variable holidays by year
const holidayCache = new Map<number, Map<string, string>>();

/**
 * Get cached variable holidays for a year.
 */
function getCachedVariableHolidays(year: number): Map<string, string> {
  if (!holidayCache.has(year)) {
    holidayCache.set(year, getVariableHolidays(year));
  }
  return holidayCache.get(year)!;
}

/**
 * Check if a date is a weekend (Saturday or Sunday).
 */
function isWeekend(date: Date): boolean {
  const day = date.getUTCDay();
  return day === 0 || day === 6; // 0 = Sunday, 6 = Saturday
}

/**
 * Check if a date is a US federal holiday that affects market trading.
 * Includes both fixed holidays and variable holidays (calculated per year).
 */
function isHoliday(date: Date): boolean {
  const monthDay = formatMonthDay(date);

  // Check fixed holidays
  if (FIXED_HOLIDAYS.includes(monthDay)) {
    return true;
  }

  // Check variable holidays for this year
  const year = date.getUTCFullYear();
  const variableHolidays = getCachedVariableHolidays(year);

  return variableHolidays.has(monthDay);
}

/**
 * Check if a date is a trading day (not weekend and not holiday).
 */
export function isTradingDay(date: Date): boolean {
  return !isWeekend(date) && !isHoliday(date);
}

/**
 * Get the next trading day after a given date.
 */
export function nextTradingDay(date: Date): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + 1);

  while (!isTradingDay(next)) {
    next.setUTCDate(next.getUTCDate() + 1);
  }

  return next;
}

/**
 * Get the previous trading day before a given date.
 */
export function previousTradingDay(date: Date): Date {
  const prev = new Date(date);
  prev.setUTCDate(prev.getUTCDate() - 1);

  while (!isTradingDay(prev)) {
    prev.setUTCDate(prev.getUTCDate() - 1);
  }

  return prev;
}

/**
 * Count trading days between two dates (inclusive).
 */
export function countTradingDays(startDate: Date, endDate: Date): number {
  let count = 0;
  const current = new Date(startDate);

  while (current <= endDate) {
    if (isTradingDay(current)) {
      count++;
    }
    current.setUTCDate(current.getUTCDate() + 1);
  }

  return count;
}

/**
 * Add N trading days to a date.
 */
export function addTradingDays(date: Date, days: number): Date {
  let current = new Date(date);
  let remaining = Math.abs(days);
  const direction = days >= 0 ? 1 : -1;

  while (remaining > 0) {
    current.setUTCDate(current.getUTCDate() + direction);
    if (isTradingDay(current)) {
      remaining--;
    }
  }

  return current;
}

/**
 * Get the last day of a quarter (Q1=Mar31, Q2=Jun30, Q3=Sep30, Q4=Dec31).
 */
export function getQuarterEnd(date: Date): Date {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();

  // Determine quarter
  let quarterEndMonth: number;
  if (month < 3) {
    quarterEndMonth = 2; // March (Q1)
  } else if (month < 6) {
    quarterEndMonth = 5; // June (Q2)
  } else if (month < 9) {
    quarterEndMonth = 8; // September (Q3)
  } else {
    quarterEndMonth = 11; // December (Q4)
  }

  // Last day of quarter month
  return new Date(Date.UTC(year, quarterEndMonth + 1, 0));
}

/**
 * Check if a date is within the last N trading days of a quarter.
 * This is the "end-of-window" (EOW) detection logic.
 *
 * @param date - The date to check
 * @param tradingDaysThreshold - Number of trading days before quarter-end (default: 5)
 * @returns true if the date is within the last N trading days of the quarter
 */
export function isQuarterEndEOW(date: Date, tradingDaysThreshold: number = 5): boolean {
  const quarterEnd = getQuarterEnd(date);
  const tradingDaysUntilEnd = countTradingDays(date, quarterEnd);

  return tradingDaysUntilEnd <= tradingDaysThreshold && tradingDaysUntilEnd >= 0;
}

/**
 * String version of isQuarterEndEOW for convenience.
 */
export function isQuarterEndEOWString(dateStr: string, tradingDaysThreshold: number = 5): boolean {
  const date = new Date(`${dateStr}T00:00:00Z`);
  return isQuarterEndEOW(date, tradingDaysThreshold);
}

/**
 * Get trading days remaining until quarter end.
 */
export function tradingDaysUntilQuarterEnd(date: Date): number {
  const quarterEnd = getQuarterEnd(date);
  return countTradingDays(date, quarterEnd);
}

/**
 * Adjust a date to the next trading day if it's not already a trading day.
 * If the date is already a trading day, returns the same date.
 * @param date - Date to adjust
 * @returns Next trading day (or same date if already a trading day)
 */
export function adjustToNextTradingDay(date: Date): Date {
  if (isTradingDay(date)) {
    return new Date(date);
  }
  return nextTradingDay(date);
}

/**
 * Adjust a date to the previous trading day if it's not already a trading day.
 * If the date is already a trading day, returns the same date.
 * @param date - Date to adjust
 * @returns Previous trading day (or same date if already a trading day)
 */
export function adjustToPreviousTradingDay(date: Date): Date {
  if (isTradingDay(date)) {
    return new Date(date);
  }
  return previousTradingDay(date);
}

/**
 * Adjust a date to the nearest trading day.
 * If the date is already a trading day, returns the same date.
 * If not, returns the closer of the next or previous trading day.
 * In case of a tie, returns the next trading day.
 * @param date - Date to adjust
 * @returns Nearest trading day
 */
export function adjustToNearestTradingDay(date: Date): Date {
  if (isTradingDay(date)) {
    return new Date(date);
  }

  const next = nextTradingDay(date);
  const prev = previousTradingDay(date);

  const daysToNext = Math.abs(next.getTime() - date.getTime()) / (24 * 60 * 60 * 1000);
  const daysToPrev = Math.abs(date.getTime() - prev.getTime()) / (24 * 60 * 60 * 1000);

  // In case of tie, prefer next trading day
  return daysToPrev < daysToNext ? prev : next;
}

/**
 * String version of adjustToNextTradingDay for convenience.
 * @param dateStr - Date string in YYYY-MM-DD format
 * @returns Adjusted date in YYYY-MM-DD format
 */
export function adjustToNextTradingDayString(dateStr: string): string {
  const date = new Date(`${dateStr}T00:00:00Z`);
  const adjusted = adjustToNextTradingDay(date);
  return adjusted.toISOString().slice(0, 10);
}

/**
 * String version of adjustToPreviousTradingDay for convenience.
 * @param dateStr - Date string in YYYY-MM-DD format
 * @returns Adjusted date in YYYY-MM-DD format
 */
export function adjustToPreviousTradingDayString(dateStr: string): string {
  const date = new Date(`${dateStr}T00:00:00Z`);
  const adjusted = adjustToPreviousTradingDay(date);
  return adjusted.toISOString().slice(0, 10);
}

/**
 * String version of adjustToNearestTradingDay for convenience.
 * @param dateStr - Date string in YYYY-MM-DD format
 * @returns Adjusted date in YYYY-MM-DD format
 */
export function adjustToNearestTradingDayString(dateStr: string): string {
  const date = new Date(`${dateStr}T00:00:00Z`);
  const adjusted = adjustToNearestTradingDay(date);
  return adjusted.toISOString().slice(0, 10);
}

/**
 * Get the name of the holiday for a given date, if it is a holiday.
 * @param date - Date to check
 * @returns Holiday name if the date is a holiday, null otherwise
 */
export function getHolidayName(date: Date): string | null {
  const monthDay = formatMonthDay(date);

  // Check fixed holidays
  const fixedHolidayNames: Record<string, string> = {
    '01-01': 'New Year\'s Day',
    '07-04': 'Independence Day',
    '12-25': 'Christmas',
  };

  if (fixedHolidayNames[monthDay]) {
    return fixedHolidayNames[monthDay];
  }

  // Check variable holidays
  const year = date.getUTCFullYear();
  const variableHolidays = getCachedVariableHolidays(year);

  return variableHolidays.get(monthDay) ?? null;
}
