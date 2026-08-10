# Contributing to Neeko

Thanks for your interest in contributing to **Neeko** — a Tauri 2.0 + React 18
desktop app that unifies multi-project AI agent sessions (Local / WSL / SSH).

This guide covers how to set up the project, the coding conventions we enforce,
the quality gates that run automatically, and how to get your changes merged.

> 中文版见 [CONTRIBUTING_CN.md](./CONTRIBUTING_CN.md)

---

## Table of Contents

- [Development Environment](#development-environment)
- [Quick Start](#quick-start)
- [Common Commands](#common-commands)
- [Project Structure](#project-structure)
- [Coding Conventions](#coding-conventions)
- [Test-Driven Development](#test-driven-development)
- [Commit Message Guidelines](#commit-message-guidelines)
- [Quality Gates](#quality-gates)
- [Testing Requirements](#testing-requirements)
- [Branching & Pull Requests](#branching--pull-requests)
- [Documentation](#documentation)
- [Release Process](#release-process)

---

## Development Environment

| Tool | Version |
| --- | --- |
| Node.js | 18+ |
| pnpm | `9.12.2` |
| Rust | edition 2021 (stable) |
| Tauri | 2.0 |

Install the Tauri system prerequisites for your platform first:

- **macOS**: Xcode Command Line Tools (`xcode-select --install`)
- **Linux**: WebKitGTK / GTK / AppIndicator / librsvg / patchelf
- **Windows**: Microsoft C++ Build Tools + WebView2

See the [Tauri prerequisites guide](https://v2.tauri.app/start/prerequisites/)
for details.

## Quick Start

```bash
pnpm install          # install frontend dependencies
pnpm tauri dev        # start the dev app (frontend on port 1420)
```

## Common Commands

| Command | Purpose |
| --- | --- |
| `pnpm tauri dev` | Run the app in development mode |
| `pnpm tauri build` | Build a release bundle |
| `pnpm lint` | Rust `cargo fmt --check` + `cargo clippy` |
| `pnpm lint:fe` | Frontend ESLint + `tsc --noEmit` + vitest typecheck |
| `pnpm lint:all` | Both Rust and frontend lint |
| `pnpm type-check` | TypeScript type check only |
| `pnpm test` | Vitest watch mode |
| `pnpm test:run` | Run frontend tests once |
| `pnpm test:coverage` | Run frontend tests with coverage |
| `cargo test --manifest-path src-tauri/Cargo.toml` | Run Rust tests |
| `pnpm release <version>` | Bump version, generate changelog, tag (see [Release](#release-process)) |

## Project Structure

### Frontend — Feature-Based architecture

```
src/
├── app/          # App entry, composition root (App.tsx, useAppShell)
├── features/     # Feature domains, each with components/ hooks/ store/
├── shared/       # Cross-domain: components, contexts, hooks, store, types, utils
├── layout/       # Window layout framework
├── ui/           # Generic UI components
└── styles/       # Global styles
```

### Backend — Domain-Driven modular architecture

```
src-tauri/src/
├── main.rs / lib.rs / app.rs / app_state.rs
├── common/       # Shared infrastructure (error, logger, runtime)
├── <domain>/     # e.g. agent, project, session, terminal, connection, git, search
│   ├── commands.rs   # Thin Tauri command layer
│   ├── services.rs   # Business logic
│   └── mod.rs        # Module aggregation + re-exports only
└── ...
```

## Coding Conventions

### Architecture principles

1. **High cohesion, low coupling** — each module has a single clear
   responsibility; modules communicate through explicit interfaces
   (props / contexts / API wrappers / `pub use` re-exports).
2. **Dependency Inversion** — high-level modules depend on abstractions, not
   concrete implementations.
3. **Open/Closed** — extend by adding new code (new variants, strategies,
   components), not by modifying existing logic. Use `Enum + match` over
   `Box<dyn Trait>` when the variant set is known and fixed.
4. **DRY / KISS / YAGNI** — abstract repeated logic (3+ occurrences), prefer
   the simplest solution, and don't build for hypothetical future needs.

### Import/Export firewall

- **No root-level barrels** (e.g. `@/components/index.ts`).
- Cross-feature **store** imports go directly to the concrete file
  (`@/features/file/store`), never re-exported through a feature `index.ts`.
- **Types** are imported directly (`export type` is erased at compile time).
- A feature's `index.ts` is a **facade only** — it re-exports public components
  and hooks, never stores or internal utilities.
- Within the same feature, import concrete files directly (no self-looping
  through the local `index.ts`).

### State management

- Keep state as close to its consumer as possible (`useState` → feature store
  → `shared/store`).
- Don't store derived state — compute it with `useMemo`.
- One-way data flow: data flows down, events flow up. Children never mutate
  parent state directly.

### Rust command layer

- Commands use `#[tauri::command]` and return `Result<T, AppError>`.
- The command layer stays **thin**: receive + validate args, then delegate to
  the service/manager.
- Register every new command in `neeko_invoke_handler!` in `src-tauri/src/lib.rs`.
- Use `crate::core::exec` / `crate::common::executor` for command execution
  (Local/WSL/SSH unified interface) — never the deprecated `local::exec` helpers.
- Blocking I/O (`std::fs`, `std::process`, PTY) must be wrapped in
  `tokio::task::spawn_blocking`.
- `mod.rs` stays thin: only `mod` declarations and `pub use` re-exports.

## Test-Driven Development

All new features and bug fixes follow the **Red → Green → Refactor** loop:

1. **Red** — write a failing test that pins down the expected behavior;
   confirm it fails for the right reason.
2. **Green** — write the minimal code to make it pass.
3. **Refactor** — clean up duplication while keeping the tests green.

**Bug fixes** start with a regression test that reproduces the bug, then the fix.

> No new code without tests. Before modifying existing code, make sure the
> existing tests pass.

## Commit Message Guidelines

We follow **Conventional Commits 1.0.0**, enforced by commitlint:

```text
<type>(<scope>): <subject>

<body>

<footer>
```

### Allowed types

`feat`, `fix`, `refactor`, `chore`, `docs`, `style`, `perf`, `test`, `build`,
`ci`, `revert`, `wip`

- **feat** — new feature
- **fix** — bug fix
- **refactor** — code refactoring (no bug fix, no new feature)
- **chore** — maintenance (deps, config, etc.)
- **docs** — documentation only
- **style** — formatting (no logic change)
- **perf** — performance improvement
- **test** — adding/fixing tests
- **build** / **ci** — build system / CI changes
- **revert** — revert a commit
- **wip** — work in progress (temporary)

### Rules

- **Scope** is optional but encouraged (`feat(search): ...`).
- **Subject** is short (≤ 50 chars), imperative, no trailing period.
  Subject may be in English or Chinese.
- Use a **body** for complex changes: explain *why* and *how*.
- Mark breaking changes with `!` after the type and a `BREAKING CHANGE:`
  footer.
- Reference issues in the footer (e.g. `Closes #123`).

### Examples

```text
feat(search): add find-in-files content search panel

Add a full-text search panel (Ctrl+Shift+F) that works across local,
WSL and SSH projects.
```

```text
fix(file): refresh expanded dir caches on file move/delete
```

Keep commits **atomic**: split unrelated changes into separate commits.

## Quality Gates

[lefthook](https://github.com/evilmartians/lefthook) runs automatically on
commit. Hooks are installed via `pnpm prepare` (or `pnpm lefthook install`).

| Hook | Trigger | Runs |
| --- | --- | --- |
| `pre-commit` | changed `src/**/*.{ts,tsx,js,jsx}` | `pnpm lint:fe` |
| `pre-commit` | changed `src-tauri/**/*.rs` | `pnpm lint` |
| `commit-msg` | every commit | `pnpm commitlint` |

A commit is blocked until all gates pass. Before opening a PR, run the full
minimal regression set locally:

```bash
pnpm lint:all
pnpm test:run
cargo test --manifest-path src-tauri/Cargo.toml
```

## Testing Requirements

| Layer | Requirement | Method |
| --- | --- | --- |
| Pure functions / utils | 100% coverage | Direct call + assert return |
| Manager logic (Rust) | Core paths covered | `#[test]` functions |
| Custom hooks (TS) | Key behavior | `renderHook` + `act` |
| Components | Key interactions | `@testing-library/react` |

Tests must be independent, fast (single test < 100ms), and not depend on
external state. Use `tempfile` for Rust tests that touch the filesystem, and
never write to the real `~/.neeko` config in tests.

## Branching & Pull Requests

1. Create a branch from `main` (e.g. `feat/<short-name>` or `fix/<short-name>`).
2. Implement following TDD, keeping commits atomic and Conventional.
3. Run the full quality gate locally (see [Quality Gates](#quality-gates)).
4. Open a PR against `main` with a clear description of the change and why.
5. Keep the PR focused on a single concern; split large changes.

## Documentation

- Update the relevant docs when behavior changes:
  - `AGENTS.md` — single source of truth for project context & conventions
  - `docs/neeko-development-spec.md` — full-stack architecture spec
  - `docs/ARCHITECTURE.md` — architecture overview
- The project maintains bilingual docs (`README.md` / `README_CN.md`,
  `CONTEXT.md` / `CONTEXT_CN.md`). When adding a doc, consider providing both
  language versions.

## Release Process

Releases are driven by `pnpm release <version>` (`scripts/release.mjs`), which:

1. Bumps the version in `package.json`, `src-tauri/Cargo.toml`, and
   `src-tauri/tauri.conf.json`.
2. Generates `CHANGELOG.md` via `git-cliff` (config in `cliff.toml`).
3. Commits `release: v<version>` and tags `v<version>`.

Pushing the tag triggers GitHub Actions to build Windows / macOS / Linux and
publish a GitHub Release with installers. See the release section of
`AGENTS.md` for details. Only maintainers with push access run releases.
