import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseIsharesAsOf, parseIsharesHoldings } from '../activities/etf.activities';

describe('iShares holdings parsing', () => {
  test('extracts as-of date from CSV header', () => {
    const csv = readFileSync(
      new URL('./fixtures/ishares_iwb_holdings_header.csv', import.meta.url),
      'utf-8'
    );
    expect(parseIsharesAsOf(csv)).toBe('2025-11-06');
  });

  test('parses holdings rows into normalized objects', () => {
    const json = readFileSync(new URL('./fixtures/ishares_iwb_holdings.json', import.meta.url), 'utf-8');
    const parsed = JSON.parse(json);
    const holdings = parseIsharesHoldings(parsed.aaData);
    expect(holdings).toHaveLength(3);

    const apple = holdings.find((item) => item.cusip === '037833100');
    expect(apple).toMatchObject({
      ticker: 'AAPL',
      shares: 10371691,
      weight: 6.37,
    });

    const microsoft = holdings.find((item) => item.cusip === '594918104');
    expect(microsoft).toMatchObject({
      ticker: 'MSFT',
      shares: 5276233,
      weight: 5.97,
    });
  });
});
