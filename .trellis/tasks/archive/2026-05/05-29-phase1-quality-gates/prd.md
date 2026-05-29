# Phase 1: Quality Infrastructure

Install ESLint and configure Clippy to enforce spec rules at build time.

## 1. ESLint Setup (Frontend)

### 1.1 Install Dependencies
```bash
pnpm add -D eslint @typescript-eslint/parser @typescript-eslint/eslint-plugin \
  eslint-plugin-import eslint-plugin-react eslint-plugin-react-hooks \
  eslint-plugin-jsx-a11y eslint-plugin-prettier eslint-plugin-check-file \
  eslint-plugin-testing-library eslint-plugin-jest-dom \
  eslint-plugin-tailwindcss eslint-plugin-vitest prettier
```

### 1.2 Create `.eslintrc.cjs`
Base on spec §3.2, but adapt zones for Neeko's 12 features:
- agent, browser, connection, editor, file, git, project, session, settings, skill, task, terminal
- Replace generic names (auth, comments, discussions, teams, users) with Neeko names

### 1.3 Update `package.json` lint script
```
"lint": "cargo fmt --manifest-path src-tauri/Cargo.toml --all -- --check && pnpm tsc --noEmit && eslint src/ && cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings"
```

### 1.4 Add `.prettierrc` if missing

## 2. Clippy Setup (Backend)

### 2.1 Add `[lints.clippy]` to `src-tauri/Cargo.toml`
Per spec §4.2. Key denies: unwrap_used, dbg_macro, todo, print_stdout, wildcard_imports

### 2.2 Add `#![deny(...)]` to `src-tauri/src/lib.rs`
Per spec §4.3:
- clippy::unwrap_used, clippy::dbg_macro, clippy::todo, clippy::print_stdout
- clippy::wildcard_imports, rust_2018_idioms, unused_must_use, missing_docs

## 3. CI Integration (package.json)

Merge frontend + backend lint into single `pnpm lint`:
- cargo fmt --check
- cargo clippy -- -D warnings
- eslint src/
- tsc --noEmit

## Files to modify
- `package.json` — devDependencies + lint script
- `.eslintrc.cjs` — new file
- `.prettierrc` — new file (or verify existing)
- `src-tauri/Cargo.toml` — add [lints.clippy]
- `src-tauri/src/lib.rs` — add #![deny(...)]

## Completion criteria
- [ ] `pnpm lint` runs all 4 checks
- [ ] ESLint config covers all 12 features with no-restricted-paths zones
- [ ] Clippy unwrap_used = "deny" active
- [ ] CI-style lint script works on first run
