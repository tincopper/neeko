# Architecture Compliance Audit — May 29

Full audit of codebase against `docs/neeko-development-spec.md`. 16 gaps across 4 severity tiers.

## P0 (Critical)

### 1. ESLint absent
- No eslint.config.* or .eslintrc.*
- No ESLint devDependencies in package.json
- `pnpm lint` = cargo fmt + tsc only
- Spec §3.1-3.2 requires full ESLint config with no-restricted-paths, no-cycle, import/order, check-file

### 2. Clippy config absent
- No `[lints]` in Cargo.toml
- No `#![deny(...)]` in lib.rs
- 271 unwrap() calls in production code with no compile-time guard
- Spec §4.2-4.3 requires clippy lints and deny attributes

### 3. No core/ dir, no services/repository layers
- error.rs, logger.rs sit at src-tauri/src/ root
- All domains: commands.rs + types.rs only (some have manager.rs)
- No repository.rs or services.rs in any domain
- Spec §2 + §6 requires layered architecture: model → repository → services → commands

## P1 (Important)

### 4. No api/ abstraction in frontend
- 12 feature modules, zero have api/ subdirectory
- 59 files call invoke() directly: hooks, stores, components, strategies, layout

### 5. shared/ → features/ reverse imports (6 violations)
- shared/types/app.ts → features/settings
- shared/types/adapter.ts → features/connection, features/project
- shared/utils/diffSource.ts → features/git
- shared/utils/browserUtils.ts → features/browser
- shared/hooks/useKeyboardShortcuts.ts → 4 features

### 6. Backend cross-domain coupling
- 51 cross-domain `use crate::` imports
- All submodules are `pub mod` (no compile-time isolation)
- Dependency web: git → project + connection, terminal → agent + connection, etc.

## P2 (Moderate)

### 7. Naming violations
- src/layout/DockLayout/ (PascalCase, should be kebab-case)
- src/features/project/hooks/useActiveProject/ (camelCase, should be kebab-case)

### 8. Duplicate cn.ts
- src/lib/utils.ts = src/shared/utils/cn.ts

## Key Metrics

| Metric | Current | Target |
|--------|---------|--------|
| ESLint config | None | .eslintrc.cjs per §3.2 |
| Clippy lints | None | [lints.clippy] per §4.2 |
| api/ directories | 0/12 | 12/12 |
| services.rs files | 0 | per domain |
| repository.rs files | 0 | skill, session, settings |
| unwrap() calls (prod) | ~200+ | 0 |
| shared→features imports | 6 | 0 |
| Cross-domain Rust imports | 51 | through services only |
