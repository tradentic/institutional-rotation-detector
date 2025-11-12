/**
 * Search Attributes Validation Test
 *
 * This test ensures that:
 * 1. The attributeConfig in workflows/utils.ts matches what's registered in Temporal
 * 2. Coding agents are alerted when search attributes need to be updated
 *
 * If this test fails, you need to update BOTH files:
 * - tools/setup-temporal-attributes.sh (Temporal registration)
 * - apps/temporal-worker/src/workflows/utils.ts (TypeScript config)
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

describe('Search Attributes Sync Validation', () => {
  it('setup-temporal-attributes.sh and workflows/utils.ts must be in sync', () => {
    // Read the setup script
    const setupScriptPath = join(__dirname, '../../../../tools/setup-temporal-attributes.sh');
    const setupScript = readFileSync(setupScriptPath, 'utf-8');

    // Read the utils file
    const utilsPath = join(__dirname, '../workflows/utils.ts');
    const utilsContent = readFileSync(utilsPath, 'utf-8');

    // Extract attribute names from setup script
    const scriptAttributes = extractAttributesFromScript(setupScript);

    // Extract attribute names from utils.ts
    const codeAttributes = extractAttributesFromCode(utilsContent);

    // Compare
    const missingInCode = scriptAttributes.filter(attr => !codeAttributes.has(attr.name));
    const extraInCode = Array.from(codeAttributes.keys()).filter(name =>
      !scriptAttributes.some(attr => attr.name === name) && name !== 'weekEnd' // weekEnd is intentionally not registered
    );

    // Check types match
    const typeMismatches: string[] = [];
    scriptAttributes.forEach(({ name, type }) => {
      const codeType = codeAttributes.get(name);
      if (codeType && codeType !== type) {
        typeMismatches.push(`${name}: script has ${type}, code has ${codeType}`);
      }
    });

    // Build error message
    const errors: string[] = [];
    if (missingInCode.length > 0) {
      errors.push(
        `Attributes in setup-temporal-attributes.sh but missing in workflows/utils.ts:\n` +
        missingInCode.map(a => `  - ${a.name} (${a.type})`).join('\n')
      );
    }
    if (extraInCode.length > 0) {
      errors.push(
        `Attributes in workflows/utils.ts but not registered in setup-temporal-attributes.sh:\n` +
        extraInCode.map(name => `  - ${name} (${codeAttributes.get(name)})`).join('\n')
      );
    }
    if (typeMismatches.length > 0) {
      errors.push(
        `Type mismatches between script and code:\n` +
        typeMismatches.map(m => `  - ${m}`).join('\n')
      );
    }

    if (errors.length > 0) {
      throw new Error(
        '\n\n' +
        '❌ Search attributes are OUT OF SYNC!\n\n' +
        errors.join('\n\n') +
        '\n\n' +
        '📝 To fix:\n' +
        '1. Update tools/setup-temporal-attributes.sh to add/remove/change attributes\n' +
        '2. Update apps/temporal-worker/src/workflows/utils.ts attributeConfig to match\n' +
        '3. Run this test again to verify\n'
      );
    }
  });
});

// Helper: Extract attributes from bash script
function extractAttributesFromScript(content: string): Array<{ name: string; type: string }> {
  const attributes: Array<{ name: string; type: string }> = [];

  // Match: create_search_attribute "Name" "Type"
  const regex = /create_search_attribute\s+"(\w+)"\s+"(\w+)"/g;
  let match;

  while ((match = regex.exec(content)) !== null) {
    attributes.push({
      name: match[1],
      type: match[2],
    });
  }

  return attributes;
}

// Helper: Extract attributes from TypeScript code
function extractAttributesFromCode(content: string): Map<string, string> {
  const attributes = new Map<string, string>();

  // Match: attributeName: { name: 'AttributeName', type: SearchAttributeType.TYPE }
  const regex = /(\w+):\s*\{\s*name:\s*'(\w+)',\s*type:\s*SearchAttributeType\.(\w+)/g;
  let match;

  while ((match = regex.exec(content)) !== null) {
    const attributeName = match[2]; // Use the Temporal name, not the TS property name
    const type = match[3]; // KEYWORD, TEXT, DATETIME
    attributes.set(attributeName, type.charAt(0) + type.slice(1).toLowerCase()); // Convert KEYWORD -> Keyword
  }

  return attributes;
}
