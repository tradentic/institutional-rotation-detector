import { describe, expect, it } from 'vitest';
import { parseNportDocument } from '../activities/nport.activities';

const sampleJson = JSON.stringify({
  edgarSubmission: {
    formData: {
      invstOrSecs: [
        {
          name: 'Sample Holding',
          identifiers: { cusip: '123456789' },
          balance: '1,500.75',
        },
        {
          name: 'Duplicate Holding',
          identifiers: { cusip: '123456789' },
          balance: '250',
        },
        {
          name: 'Secondary',
          identifiers: { cusip: '987654321' },
          balance: '100',
        },
      ],
    },
  },
});

const sampleXml = `<?xml version="1.0" encoding="UTF-8"?>
<edgarSubmission>
  <formData>
    <invstOrSecs>
      <invstOrSec>
        <name>XML Holding</name>
        <identifiers>
          <cusip>222333444</cusip>
        </identifiers>
        <balance>345.6</balance>
      </invstOrSec>
      <invstOrSec>
        <name>No Cusip</name>
        <balance>100</balance>
      </invstOrSec>
    </invstOrSecs>
  </formData>
</edgarSubmission>`;

describe('parseNportDocument', () => {
  it('aggregates holdings from JSON payloads', () => {
    const holdings = parseNportDocument(sampleJson);
    expect(holdings).toEqual([
      { cusip: '123456789', shares: 1751 },
      { cusip: '987654321', shares: 100 },
    ]);
  });

  it('parses holdings from XML payloads', () => {
    const holdings = parseNportDocument(sampleXml);
    expect(holdings).toEqual([{ cusip: '222333444', shares: 346 }]);
  });
});
