import path from 'node:path';
import { defineConfig } from 'vitest/config';

const repoRoot = path.resolve(__dirname, '..', '..');
const alias = {
  '@libs/finra-client': path.resolve(repoRoot, 'libs/finra-client/src/index.ts'),
  '@libs/unusualwhales-client': path.resolve(repoRoot, 'libs/unusualwhales-client/src/index.ts'),
  '@libs/openai-client': path.resolve(repoRoot, 'libs/openai-client/src/index.ts'),
};

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
  },
  resolve: {
    alias,
  },
});
