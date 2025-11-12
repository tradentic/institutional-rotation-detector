import { describe, test, expect } from 'vitest';
import {
  isTradingDay,
  nextTradingDay,
  previousTradingDay,
  countTradingDays,
  addTradingDays,
  getQuarterEnd,
  isQuarterEndEOW,
  tradingDaysUntilQuarterEnd,
  adjustToNextTradingDay,
  adjustToPreviousTradingDay,
  adjustToNearestTradingDay,
  adjustToNextTradingDayString,
  adjustToPreviousTradingDayString,
  adjustToNearestTradingDayString,
  getHolidayName,
} from '../lib/tradingCalendar';

describe('tradingCalendar', () => {
  describe('isTradingDay', () => {
    test('weekdays are trading days', () => {
      const monday = new Date('2024-01-08T00:00:00Z'); // Monday
      const friday = new Date('2024-01-12T00:00:00Z'); // Friday
      expect(isTradingDay(monday)).toBe(true);
      expect(isTradingDay(friday)).toBe(true);
    });

    test('weekends are not trading days', () => {
      const saturday = new Date('2024-01-13T00:00:00Z');
      const sunday = new Date('2024-01-14T00:00:00Z');
      expect(isTradingDay(saturday)).toBe(false);
      expect(isTradingDay(sunday)).toBe(false);
    });

    test('holidays are not trading days', () => {
      const newYears = new Date('2024-01-01T00:00:00Z');
      const july4th = new Date('2024-07-04T00:00:00Z');
      const christmas = new Date('2024-12-25T00:00:00Z');
      expect(isTradingDay(newYears)).toBe(false);
      expect(isTradingDay(july4th)).toBe(false);
      expect(isTradingDay(christmas)).toBe(false);
    });
  });

  describe('nextTradingDay', () => {
    test('skips weekends', () => {
      const friday = new Date('2024-01-12T00:00:00Z');
      const nextDay = nextTradingDay(friday);
      expect(nextDay.getUTCDate()).toBe(15); // Monday
    });

    test('skips holidays', () => {
      const dec24 = new Date('2024-12-24T00:00:00Z');
      const nextDay = nextTradingDay(dec24);
      expect(nextDay.getUTCDate()).toBe(26); // Skips Dec 25 (Christmas)
    });
  });

  describe('previousTradingDay', () => {
    test('skips weekends', () => {
      const monday = new Date('2024-01-15T00:00:00Z');
      const prevDay = previousTradingDay(monday);
      expect(prevDay.getUTCDate()).toBe(12); // Friday
    });
  });

  describe('countTradingDays', () => {
    test('counts only trading days in a week', () => {
      const monday = new Date('2024-01-08T00:00:00Z');
      const friday = new Date('2024-01-12T00:00:00Z');
      const count = countTradingDays(monday, friday);
      expect(count).toBe(5); // Mon, Tue, Wed, Thu, Fri
    });

    test('excludes weekends', () => {
      const monday = new Date('2024-01-08T00:00:00Z');
      const nextMonday = new Date('2024-01-15T00:00:00Z');
      const count = countTradingDays(monday, nextMonday);
      expect(count).toBe(6); // Two weeks minus weekends
    });
  });

  describe('addTradingDays', () => {
    test('adds trading days correctly', () => {
      const monday = new Date('2024-01-08T00:00:00Z');
      const result = addTradingDays(monday, 5);
      expect(result.getUTCDate()).toBe(15); // Next Monday (skips weekend)
    });

    test('subtracts trading days correctly', () => {
      const friday = new Date('2024-01-12T00:00:00Z');
      const result = addTradingDays(friday, -5);
      expect(result.getUTCDate()).toBe(5); // Previous Friday (skips weekend)
    });
  });

  describe('getQuarterEnd', () => {
    test('Q1 ends on March 31', () => {
      const jan15 = new Date('2024-01-15T00:00:00Z');
      const qEnd = getQuarterEnd(jan15);
      expect(qEnd.getUTCMonth()).toBe(2); // March (0-indexed)
      expect(qEnd.getUTCDate()).toBe(31);
    });

    test('Q2 ends on June 30', () => {
      const may15 = new Date('2024-05-15T00:00:00Z');
      const qEnd = getQuarterEnd(may15);
      expect(qEnd.getUTCMonth()).toBe(5); // June
      expect(qEnd.getUTCDate()).toBe(30);
    });

    test('Q3 ends on September 30', () => {
      const aug15 = new Date('2024-08-15T00:00:00Z');
      const qEnd = getQuarterEnd(aug15);
      expect(qEnd.getUTCMonth()).toBe(8); // September
      expect(qEnd.getUTCDate()).toBe(30);
    });

    test('Q4 ends on December 31', () => {
      const nov15 = new Date('2024-11-15T00:00:00Z');
      const qEnd = getQuarterEnd(nov15);
      expect(qEnd.getUTCMonth()).toBe(11); // December
      expect(qEnd.getUTCDate()).toBe(31);
    });
  });

  describe('isQuarterEndEOW', () => {
    test('last 5 trading days of Q2 2024', () => {
      // June 30, 2024 is a Sunday, so last trading day is June 28 (Friday)
      // Last 5 trading days: Jun 24-28 (Mon-Fri)
      const jun24 = new Date('2024-06-24T00:00:00Z'); // Monday
      const jun28 = new Date('2024-06-28T00:00:00Z'); // Friday
      const jun21 = new Date('2024-06-21T00:00:00Z'); // Friday (6 days before)

      expect(isQuarterEndEOW(jun28, 5)).toBe(true);
      expect(isQuarterEndEOW(jun24, 5)).toBe(true);
      expect(isQuarterEndEOW(jun21, 5)).toBe(false);
    });

    test('last trading day of quarter is always EOW', () => {
      const mar29_2024 = new Date('2024-03-29T00:00:00Z'); // Friday before Mar 31 (Sunday)
      expect(isQuarterEndEOW(mar29_2024, 5)).toBe(true);
    });

    test('middle of quarter is not EOW', () => {
      const feb15 = new Date('2024-02-15T00:00:00Z');
      expect(isQuarterEndEOW(feb15, 5)).toBe(false);
    });

    test('custom threshold works', () => {
      const jun25 = new Date('2024-06-25T00:00:00Z');
      expect(isQuarterEndEOW(jun25, 3)).toBe(true); // Within last 3 days
      expect(isQuarterEndEOW(jun25, 1)).toBe(false); // Not within last 1 day
    });
  });

  describe('tradingDaysUntilQuarterEnd', () => {
    test('calculates days remaining correctly', () => {
      const jun24 = new Date('2024-06-24T00:00:00Z');
      const days = tradingDaysUntilQuarterEnd(jun24);
      expect(days).toBeGreaterThan(0);
      expect(days).toBeLessThanOrEqual(5);
    });
  });

  describe('variable holidays', () => {
    test('MLK Day 2024 (3rd Monday in January) is not a trading day', () => {
      const mlkDay2024 = new Date('2024-01-15T00:00:00Z'); // 3rd Monday in January
      expect(isTradingDay(mlkDay2024)).toBe(false);
      expect(getHolidayName(mlkDay2024)).toBe('MLK Day');
    });

    test('Presidents Day 2024 (3rd Monday in February) is not a trading day', () => {
      const presidentsDay2024 = new Date('2024-02-19T00:00:00Z'); // 3rd Monday in February
      expect(isTradingDay(presidentsDay2024)).toBe(false);
      expect(getHolidayName(presidentsDay2024)).toBe('Presidents Day');
    });

    test('Good Friday 2024 is not a trading day', () => {
      const goodFriday2024 = new Date('2024-03-29T00:00:00Z'); // Friday before Easter 2024
      expect(isTradingDay(goodFriday2024)).toBe(false);
      expect(getHolidayName(goodFriday2024)).toBe('Good Friday');
    });

    test('Memorial Day 2024 (last Monday in May) is not a trading day', () => {
      const memorialDay2024 = new Date('2024-05-27T00:00:00Z'); // Last Monday in May
      expect(isTradingDay(memorialDay2024)).toBe(false);
      expect(getHolidayName(memorialDay2024)).toBe('Memorial Day');
    });

    test('Juneteenth 2024 is not a trading day', () => {
      const juneteenth2024 = new Date('2024-06-19T00:00:00Z'); // June 19
      expect(isTradingDay(juneteenth2024)).toBe(false);
      expect(getHolidayName(juneteenth2024)).toBe('Juneteenth');
    });

    test('Labor Day 2024 (1st Monday in September) is not a trading day', () => {
      const laborDay2024 = new Date('2024-09-02T00:00:00Z'); // 1st Monday in September
      expect(isTradingDay(laborDay2024)).toBe(false);
      expect(getHolidayName(laborDay2024)).toBe('Labor Day');
    });

    test('Thanksgiving 2024 (4th Thursday in November) is not a trading day', () => {
      const thanksgiving2024 = new Date('2024-11-28T00:00:00Z'); // 4th Thursday in November
      expect(isTradingDay(thanksgiving2024)).toBe(false);
      expect(getHolidayName(thanksgiving2024)).toBe('Thanksgiving');
    });

    test('Juneteenth observed on Friday when it falls on Saturday', () => {
      const juneteenth2021 = new Date('2021-06-18T00:00:00Z'); // June 19, 2021 was Saturday, observed Friday June 18
      expect(isTradingDay(juneteenth2021)).toBe(false);
      expect(getHolidayName(juneteenth2021)).toBe('Juneteenth');
    });
  });

  describe('adjustToNextTradingDay', () => {
    test('returns same date if already a trading day', () => {
      const tuesday = new Date('2024-01-09T00:00:00Z'); // Tuesday
      const adjusted = adjustToNextTradingDay(tuesday);
      expect(adjusted.toISOString().slice(0, 10)).toBe('2024-01-09');
    });

    test('adjusts New Year\'s Day to next trading day', () => {
      const newYears = new Date('2024-01-01T00:00:00Z'); // Monday (holiday)
      const adjusted = adjustToNextTradingDay(newYears);
      expect(adjusted.toISOString().slice(0, 10)).toBe('2024-01-02'); // Tuesday
    });

    test('adjusts weekend to Monday', () => {
      const saturday = new Date('2024-01-13T00:00:00Z'); // Saturday
      const adjusted = adjustToNextTradingDay(saturday);
      expect(adjusted.toISOString().slice(0, 10)).toBe('2024-01-16'); // Tuesday (MLK Day is Jan 15)
    });

    test('string version works correctly', () => {
      const adjusted = adjustToNextTradingDayString('2024-01-01');
      expect(adjusted).toBe('2024-01-02');
    });
  });

  describe('adjustToPreviousTradingDay', () => {
    test('returns same date if already a trading day', () => {
      const tuesday = new Date('2024-01-09T00:00:00Z'); // Tuesday
      const adjusted = adjustToPreviousTradingDay(tuesday);
      expect(adjusted.toISOString().slice(0, 10)).toBe('2024-01-09');
    });

    test('adjusts New Year\'s Day to previous trading day', () => {
      const newYears = new Date('2024-01-01T00:00:00Z'); // Monday (holiday)
      const adjusted = adjustToPreviousTradingDay(newYears);
      expect(adjusted.toISOString().slice(0, 10)).toBe('2023-12-29'); // Previous Friday
    });

    test('adjusts weekend to Friday', () => {
      const sunday = new Date('2024-01-14T00:00:00Z'); // Sunday
      const adjusted = adjustToPreviousTradingDay(sunday);
      expect(adjusted.toISOString().slice(0, 10)).toBe('2024-01-12'); // Friday
    });

    test('string version works correctly', () => {
      const adjusted = adjustToPreviousTradingDayString('2024-01-01');
      expect(adjusted).toBe('2023-12-29');
    });
  });

  describe('adjustToNearestTradingDay', () => {
    test('returns same date if already a trading day', () => {
      const tuesday = new Date('2024-01-09T00:00:00Z'); // Tuesday
      const adjusted = adjustToNearestTradingDay(tuesday);
      expect(adjusted.toISOString().slice(0, 10)).toBe('2024-01-09');
    });

    test('adjusts Saturday to Friday (closer)', () => {
      const saturday = new Date('2024-01-06T00:00:00Z'); // Saturday
      const adjusted = adjustToNearestTradingDay(saturday);
      expect(adjusted.toISOString().slice(0, 10)).toBe('2024-01-05'); // Friday
    });

    test('adjusts Sunday to Monday (closer)', () => {
      const sunday = new Date('2024-01-07T00:00:00Z'); // Sunday
      const adjusted = adjustToNearestTradingDay(sunday);
      expect(adjusted.toISOString().slice(0, 10)).toBe('2024-01-08'); // Monday
    });

    test('string version works correctly', () => {
      const adjusted = adjustToNearestTradingDayString('2024-01-06'); // Saturday
      expect(adjusted).toBe('2024-01-05'); // Friday
    });
  });

  describe('getHolidayName', () => {
    test('returns null for trading days', () => {
      const tuesday = new Date('2024-01-09T00:00:00Z');
      expect(getHolidayName(tuesday)).toBe(null);
    });

    test('returns holiday name for fixed holidays', () => {
      const newYears = new Date('2024-01-01T00:00:00Z');
      const july4th = new Date('2024-07-04T00:00:00Z');
      const christmas = new Date('2024-12-25T00:00:00Z');
      expect(getHolidayName(newYears)).toBe('New Year\'s Day');
      expect(getHolidayName(july4th)).toBe('Independence Day');
      expect(getHolidayName(christmas)).toBe('Christmas');
    });

    test('returns holiday name for variable holidays', () => {
      const mlkDay = new Date('2024-01-15T00:00:00Z');
      const thanksgiving = new Date('2024-11-28T00:00:00Z');
      expect(getHolidayName(mlkDay)).toBe('MLK Day');
      expect(getHolidayName(thanksgiving)).toBe('Thanksgiving');
    });

    test('returns null for weekends', () => {
      const saturday = new Date('2024-01-13T00:00:00Z');
      const sunday = new Date('2024-01-14T00:00:00Z');
      expect(getHolidayName(saturday)).toBe(null);
      expect(getHolidayName(sunday)).toBe(null);
    });
  });

  describe('quarter start date handling - the original issue', () => {
    test('Q1 2024 start (Jan 1) is New Year\'s Day and should adjust', () => {
      const q1Start = '2024-01-01'; // New Year's Day (Monday)
      const adjusted = adjustToNextTradingDayString(q1Start);
      expect(adjusted).toBe('2024-01-02'); // Tuesday
      expect(isTradingDay(new Date(`${adjusted}T00:00:00Z`))).toBe(true);
    });

    test('Q2 2024 start (Apr 1) is a trading day', () => {
      const q2Start = '2024-04-01'; // Monday
      const adjusted = adjustToNextTradingDayString(q2Start);
      expect(adjusted).toBe('2024-04-01'); // Same day (already trading day)
      expect(isTradingDay(new Date(`${adjusted}T00:00:00Z`))).toBe(true);
    });

    test('Q3 2024 start (Jul 1) is a trading day', () => {
      const q3Start = '2024-07-01'; // Monday
      const adjusted = adjustToNextTradingDayString(q3Start);
      expect(adjusted).toBe('2024-07-01'); // Same day
      expect(isTradingDay(new Date(`${adjusted}T00:00:00Z`))).toBe(true);
    });

    test('Q4 2024 start (Oct 1) is a trading day', () => {
      const q4Start = '2024-10-01'; // Tuesday
      const adjusted = adjustToNextTradingDayString(q4Start);
      expect(adjusted).toBe('2024-10-01'); // Same day
      expect(isTradingDay(new Date(`${adjusted}T00:00:00Z`))).toBe(true);
    });

    test('Q1 2025 start (Jan 1) is New Year\'s Day (Wednesday) and should adjust', () => {
      const q1Start = '2025-01-01'; // New Year's Day (Wednesday)
      const adjusted = adjustToNextTradingDayString(q1Start);
      expect(adjusted).toBe('2025-01-02'); // Thursday
      expect(isTradingDay(new Date(`${adjusted}T00:00:00Z`))).toBe(true);
    });
  });
});
