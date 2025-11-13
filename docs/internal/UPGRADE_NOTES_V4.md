# Upgrade Notes: Tailwind CSS v4 & Zod v4

## Overview

This document summarizes the upgrade to Tailwind CSS v4 and Zod v4, including changes made and migration notes.

## Package Upgrades

### Tailwind CSS
- **Previous Version**: 3.4.18
- **Current Version**: 4.1.17
- **Scope**: `apps/admin` (Next.js admin application)

### Zod
- **Previous Version**: 3.23.8 - 3.25.76
- **Current Version**: 4.1.12
- **Scope**:
  - `apps/admin`
  - `apps/api`
  - `apps/temporal-worker`

## Changes Made

### Tailwind CSS v4 Migration

Tailwind CSS v4 introduces a CSS-first configuration approach. The following changes were made:

#### 1. PostCSS Plugin Installation
- Added `@tailwindcss/postcss@4.1.17` as a dev dependency
- Updated `postcss.config.js` to use `@tailwindcss/postcss`

#### 2. CSS Configuration Migration
**File**: `apps/admin/app/globals.css`

- Changed from `@tailwind` directives to `@import "tailwindcss"`
- Moved theme configuration to `@theme` directive in CSS
- Registered custom colors in `@theme` block using `--color-*` naming convention
- Maintained CSS custom properties in `:root` and `.dark` for runtime theming

**Before**:
```css
@tailwind base;
@tailwind components;
@tailwind utilities;
```

**After**:
```css
@import "tailwindcss";

@theme {
  /* Custom colors, animations, and theme configuration */
  --color-border: hsl(var(--border));
  --color-background: hsl(var(--background));
  /* ... more custom colors ... */
}
```

#### 3. Tailwind Config Simplification
**File**: `apps/admin/tailwind.config.ts`

- Removed theme configuration (now in CSS)
- Kept minimal config for content paths and plugins
- Maintained `tailwindcss-animate` plugin support

#### 4. Color System
- CSS variables in `:root` and `.dark` remain unchanged (for runtime theming)
- Added corresponding `--color-*` definitions in `@theme` for Tailwind utilities
- This dual approach ensures both build-time and runtime theming work correctly

### Zod v4 Migration

Zod v4 is largely backward compatible. No code changes were required:

- All existing schemas continue to work without modifications
- Usage patterns (`.parse()`, `.safeParse()`, `.infer<>`) remain unchanged
- Enum definitions, unions, and nested schemas work as before

## Compatibility Notes

### Tailwind CSS v4
- **Breaking Change**: CSS-first configuration is the preferred approach
- **Plugin System**: Plugins still require JavaScript configuration
- **Migration Path**: Theme values can gradually move to CSS while maintaining JS config for complex use cases
- **Next.js**: Compatible with Next.js 15+ (uses PostCSS integration)

### Zod v4
- **Backward Compatible**: Most v3 code works without changes
- **Type Inference**: Improved type inference in v4
- **Performance**: Better runtime performance and smaller bundle size

## Testing

All packages build successfully:
- ✅ `apps/admin` - Next.js build passes
- ✅ `apps/api` - TypeScript compilation successful
- ✅ `apps/temporal-worker` - TypeScript compilation successful
- ✅ `libs/openai-client` - Library build successful

## Benefits

### Tailwind CSS v4
- **Better Performance**: Faster build times with optimized CSS processing
- **CSS-First**: More intuitive theme configuration in CSS
- **Type Safety**: Improved TypeScript support
- **Bug Fixes**: Contains important bug fixes from v3

### Zod v4
- **Improved Performance**: Faster validation and smaller bundle size
- **Better Type Inference**: More accurate TypeScript types
- **Bug Fixes**: Resolves edge cases from v3
- **Modern Features**: Enhanced schema composition and transformation

## Rollback Instructions

If needed, to rollback:

```bash
# In apps/admin
pnpm remove @tailwindcss/postcss
pnpm add -D tailwindcss@3.4.18

# Restore old postcss.config.js
# Restore old tailwind.config.ts
# Restore old globals.css

# For Zod (in all packages)
pnpm add zod@3.25.76  # or appropriate v3 version
```

## References

- [Tailwind CSS v4 Documentation](https://tailwindcss.com/docs)
- [Tailwind CSS v4 Migration Guide](https://tailwindcss.com/docs/v4-migration)
- [Zod v4 Release Notes](https://github.com/colinhacks/zod/releases)
- [Zod Documentation](https://zod.dev/)

## Date

Upgraded: 2025-11-12
