export function resolveQuarterRange(from: string, to: string): string[] {
  const start = new Date(from);
  const end = new Date(to);
  const quarters: string[] = [];
  let cursor = new Date(start);
  while (cursor <= end) {
    const year = cursor.getUTCFullYear();
    const q = Math.floor(cursor.getUTCMonth() / 3) + 1;
    quarters.push(`${year}Q${q}`);
    cursor.setUTCMonth(cursor.getUTCMonth() + 3);
  }
  return Array.from(new Set(quarters));
}

export function quarterBounds(quarter: string) {
  const match = quarter.match(/(\d{4})Q([1-4])/);
  if (!match) throw new Error('Invalid quarter');
  const year = Number(match[1]);
  const q = Number(match[2]);
  const startMonth = (q - 1) * 3;
  const start = new Date(Date.UTC(year, startMonth, 1));
  const end = new Date(Date.UTC(year, startMonth + 3, 0));
  return {
    start: start.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10),
  };
}
