# Fix Skill Feature Imports and Create Re-export Stubs

## Context

Skill feature files have been moved from their original locations to `src/features/skill/`:
- `src/components/skills/*.tsx` → `src/features/skill/components/`
- `src/hooks/useMarketplace.ts` → `src/features/skill/hooks/useMarketplace.ts`
- `src/store/skillStore.ts` → `src/features/skill/store.ts`

The internal imports are now broken because relative paths changed depth.

## Requirements

### 1. Fix imports in `src/features/skill/components/` (was `src/components/skills/`)

Import fix rules:
- `../../types` → `../../../types`
- `../../utils/` → `../../../utils/`
- `../../store/` → `../../../store/`
- `../../contexts/` → `../../../contexts/`
- `../../components/` → `../../../components/`
- `../ui/` → `@/ui/`
- `../shared/` → `../../../components/shared/`
- `./useLocalSkillActions` → no change (same feature)

### 2. Fix imports in `src/features/skill/hooks/useMarketplace.ts` (was `src/hooks/`)

- `../types` → `../../types`
- `../store/skillStore` → `../store` (same feature)

### 3. Fix imports in `src/features/skill/store.ts` (was `src/store/`)

- `../types` → `../../types`

### 4. Create re-export stubs at old locations

- `src/components/skills/index.ts` → re-export from `@/features/skill/components`
- `src/hooks/useMarketplace.ts` → re-export from `@/features/skill/hooks/useMarketplace`
- `src/store/skillStore.ts` → re-export from `@/features/skill/store`

### 5. Create barrel export

- `src/features/skill/index.ts` → barrel export for the feature

## Verification

Run `pnpm type-check` to verify all imports resolve correctly.
