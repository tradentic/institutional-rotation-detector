function splitLines(input: string): string[] {
  return input
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .filter((line) => line.trim().length > 0);
}

function parseRecord(line: string): string[] {
  const values: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (inQuotes) {
      if (char === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        current += char;
      }
      continue;
    }
    if (char === '"') {
      inQuotes = true;
      continue;
    }
    if (char === ',') {
      values.push(current.trim());
      current = '';
      continue;
    }
    current += char;
  }
  values.push(current.trim());
  return values;
}

export interface ParsedCsv {
  headers: string[];
  rows: Record<string, string>[];
}

export function parseCsv(content: string): ParsedCsv {
  const lines = splitLines(content);
  if (lines.length === 0) {
    return { headers: [], rows: [] };
  }
  const headers = parseRecord(lines[0]).map((header) => header.trim());
  const rows = lines.slice(1).map((line) => {
    const values = parseRecord(line);
    const row: Record<string, string> = {};
    for (let i = 0; i < headers.length; i++) {
      row[headers[i].toLowerCase()] = values[i] ?? '';
    }
    return row;
  });
  return { headers, rows };
}
