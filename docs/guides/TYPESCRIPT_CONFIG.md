# TypeScript Configuration Guide

Guide to the TypeScript configuration and build system for the monorepo.

## Overview

This project uses a monorepo structure with TypeScript configured for modern ESM (ES Modules) with clean imports and proper build outputs.

## Build System

### Structure

```
institutional-rotation-detector/
├── libs/
│   └── openai-client/
│       ├── src/              # TypeScript source
│       ├── dist/             # Built JavaScript + declarations
│       ├── tsconfig.json     # Library config
│       └── package.json      # Exports from dist/
├── apps/
│   ├── api/
│   │   ├── src/              # TypeScript source
│   │   ├── dist/             # Built JavaScript + declarations
│   │   └── tsconfig.json     # App config
│   ├── temporal-worker/
│   │   ├── src/              # TypeScript source
│   │   ├── dist/             # Built JavaScript + declarations
│   │   └── tsconfig.json     # App config
│   └── admin/                # Next.js (handles its own build)
└── package.json              # Root with build scripts
```

### Build Commands

```bash
# Build everything (libs first, then apps)
pnpm build

# Build only libraries
pnpm build:libs

# Build specific apps
pnpm build:worker
pnpm build:api
pnpm build:admin

# Clean all build outputs
pnpm clean
```

## TypeScript Configuration

### Module Resolution: `bundler`

All packages use `moduleResolution: "bundler"` for clean, extensionless imports:

```json
{
  "compilerOptions": {
    "module": "ESNext",
    "moduleResolution": "bundler",
    "target": "ES2022"
  }
}
```

**Benefits:**
- ✅ No file extensions needed in imports
- ✅ Clean, readable code
- ✅ Optimized for monorepos
- ✅ ESM output compatible

### Import Syntax

**Clean imports without extensions:**

```typescript
// Internal imports - no extensions
import { createSupabaseClient } from '../../../temporal-worker/src/lib/supabase';
import type { GraphQueryInput } from './graphQuery.workflow';

// Package imports
import { runResponse } from '@libs/openai-client';
import { Connection } from '@temporalio/client';
```

**Not this (old node16 style):**

```typescript
// ❌ Don't use .js extensions with bundler resolution
import { createSupabaseClient } from '../../../temporal-worker/src/lib/supabase.js';
```

### Shared Library Configuration

**libs/openai-client/tsconfig.json:**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "outDir": "dist",
    "rootDir": "src",
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "esModuleInterop": true,
    "strict": true,
    "skipLibCheck": true,
    "types": ["node"]
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

**libs/openai-client/package.json:**

```json
{
  "name": "@libs/openai-client",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "scripts": {
    "build": "tsc -p tsconfig.json"
  }
}
```

### App Configuration

**apps/api/tsconfig.json:**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "outDir": "./dist",
    "declaration": true,
    "esModuleInterop": true,
    "strict": true,
    "skipLibCheck": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

**Note:** No `rootDir` restriction in apps, allowing cross-app imports.

## Package Workspace

### pnpm-workspace.yaml

```yaml
packages:
  - 'apps/*'
  - 'libs/*'
```

### Workspace Dependencies

Apps reference shared libraries using workspace protocol:

```json
{
  "dependencies": {
    "@libs/openai-client": "workspace:*"
  }
}
```

pnpm automatically resolves `workspace:*` to the local package.

## Build Order

The root `package.json` ensures correct build order:

```json
{
  "scripts": {
    "build": "pnpm -r --filter './libs/**' run build && pnpm -r --filter './apps/**' run build",
    "build:libs": "pnpm -r --filter './libs/**' run build"
  }
}
```

This ensures:
1. All libs build first (e.g., `@libs/openai-client`)
2. Then apps build (can import built libs)

## Module Type: ESM

All packages use ESM (not CommonJS):

```json
{
  "type": "module"
}
```

**Implications:**
- Use `import`/`export`, not `require()`
- File extensions: `.js` for compiled output
- Node.js runs as ESM

## Git Ignore

Build artifacts are ignored:

```gitignore
# Build output
dist/
build/
.next/

# Generated files in source directories
apps/**/src/**/*.js
apps/**/src/**/*.js.map
apps/**/src/**/*.d.ts
apps/**/src/**/*.d.ts.map
libs/**/src/**/*.js
libs/**/src/**/*.js.map
libs/**/src/**/*.d.ts
```

TypeScript sometimes generates files in `src/` during compilation. These are excluded from git.

## Development Workflow

### 1. Make Changes

Edit TypeScript files in `src/`:

```bash
# Example: Edit a file
nano apps/temporal-worker/src/activities/my-activity.ts
```

### 2. Build

Build from repo root:

```bash
pnpm build
```

Or build specific package:

```bash
cd apps/temporal-worker
pnpm build
```

### 3. Run

Run the built JavaScript:

```bash
cd apps/temporal-worker
node dist/worker.js
```

### 4. Iterate

For rapid development, use watch mode (if configured):

```bash
# In the package directory
tsc --watch
```

## Common Issues

### Issue: Cannot find module '@libs/openai-client'

**Solution:** Build the library first:

```bash
pnpm build:libs
```

### Issue: Import errors after changing library code

**Solution:** Rebuild the library:

```bash
cd libs/openai-client
pnpm build
```

### Issue: Type errors about missing declarations

**Solution:** Ensure `declaration: true` in tsconfig.json and rebuild.

### Issue: Module not found errors at runtime

**Solution:** Check that:
1. Package has `"type": "module"` in package.json
2. Built output is in `dist/`
3. Package.json exports point to `dist/`

## Why bundler Resolution?

We chose `bundler` over `node16` for several reasons:

### bundler (Current)

✅ **Clean imports:** No `.js` extensions in TypeScript
✅ **Better DX:** Less confusion for developers
✅ **Monorepo friendly:** Designed for this use case
✅ **ESM output:** Still generates proper ES modules

### node16 (Alternative)

✅ **Strict ESM:** Enforces Node.js ESM semantics exactly
✅ **Runtime accurate:** Catches more compatibility issues
❌ **Confusing:** Requires `.js` in `.ts` files
❌ **Verbose:** More cognitive overhead

For our monorepo with internal packages (not publishing to npm), `bundler` provides the best developer experience while maintaining ESM compatibility.

## Migration Notes

### From node16 to bundler

If you see old code with `.js` extensions in imports:

```typescript
// Old (node16)
import { foo } from './bar.js';

// New (bundler)
import { foo } from './bar';
```

The change is simple - remove the `.js` extension. TypeScript still resolves to the correct `.ts` file during development and outputs `.js` during build.

## References

- [TypeScript Module Resolution](https://www.typescriptlang.org/docs/handbook/modules/theory.html#module-resolution)
- [TypeScript ESM Node.js Guide](https://www.typescriptlang.org/docs/handbook/modules/guides/esm-node.html)
- [pnpm Workspace](https://pnpm.io/workspaces)

---

**Last Updated:** 2025-11-12
**TypeScript Version:** 5.4.5+
