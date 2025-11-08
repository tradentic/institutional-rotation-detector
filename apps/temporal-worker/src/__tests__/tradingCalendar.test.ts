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
} from '../lib/tradingCalendar.js';

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
});
