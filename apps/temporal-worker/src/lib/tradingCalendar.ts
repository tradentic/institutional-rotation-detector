/**
 * Trading calendar utilities for US markets.
 * Handles business days, quarter-end detection, and EOW (end-of-window) logic.
 */

/**
 * US Federal holidays that affect NYSE trading (fixed dates).
 * Note: Some holidays (like Thanksgiving, Good Friday) have variable dates.
 */
const FIXED_HOLIDAYS = [
  '01-01', // New Year's Day
  '07-04', // Independence Day
  '12-25', // Christmas
];

/**
 * Check if a date is a weekend (Saturday or Sunday).
 */
function isWeekend(date: Date): boolean {
  const day = date.getUTCDay();
  return day === 0 || day === 6; // 0 = Sunday, 6 = Saturday
}

/**
 * Check if a date is a US federal holiday (simplified).
 * For production, use a comprehensive holiday calendar library.
 */
function isHoliday(date: Date): boolean {
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  const key = `${month}-${day}`;

  if (FIXED_HOLIDAYS.includes(key)) {
    return true;
  }

  // TODO: Add variable holidays (Thanksgiving, Good Friday, Memorial Day, Labor Day)
  // For now, this is a simplified implementation

  return false;
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
  const lastTradingDay = isTradingDay(quarterEnd) ? quarterEnd : previousTradingDay(quarterEnd);

  if (date > lastTradingDay) {
    return false;
  }

  const tradingDaysUntilEnd = countTradingDays(date, lastTradingDay);
  const remainingExcludingToday = Math.max(
    0,
    tradingDaysUntilEnd - (isTradingDay(date) ? 1 : 0)
  );

  if (remainingExcludingToday < tradingDaysThreshold) {
    return true;
  }

  if (remainingExcludingToday > tradingDaysThreshold) {
    return false;
  }

  const nextCalendarDay = new Date(date);
  nextCalendarDay.setUTCDate(nextCalendarDay.getUTCDate() + 1);
  return isTradingDay(nextCalendarDay);
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
