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
| Node.js | `>=24` |
| pnpm | `11.25.0` |
| Rust | edition 2021 (stable) |
| Tauri | 2.0 |

> Exact versions are owned by the `engines` / `packageManager` fields in
> `package.json`; the table above is only a snapshot.

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
| `pnpm lint` | Rust fmt + clippy(-D warnings) + all Python guards + guard unit tests + Java host |
| `pnpm lint:fe` | Frontend ESLint + `tsc --noEmit` + vitest typecheck |
| `pnpm lint:all` | Both Rust and frontend lint |
| `pnpm type-check` | TypeScript type check only |
| `pnpm test` | Vitest watch mode |
| `pnpm test:run` | Run frontend tests once |
| `pnpm test:coverage` | Run frontend tests with coverage |
| `cargo test --manifest-path src-tauri/Cargo.toml` | Run Rust tests |
| `pnpm release <version>` | Bump version, generate changelog, tag (see [Release](#release-process)) |

## Project Structure

The per-side `AGENTS.md` files are the **single source of truth** for directory
trees and module responsibilities; this guide does not restate them (copies drift):

- Frontend (Feature-Based): `src/AGENTS.md` → "模块布局"
- Backend (Domain-Driven): `src-tauri/AGENTS.md` → "模块布局"
- Full-stack overview: `docs/ARCHITECTURE.md`

List directories with `ls` / Glob instead of maintaining a copy — the root
`AGENTS.md` "顶层目录" section makes that a standing rule.

## Coding Conventions

The **single source of truth** for conventions is [`AGENTS.md`](./AGENTS.md) at
the repo root: its 15 "review red lines" are enforced by the
`check_agents_md_size.py` guard (every rule's full text lives in exactly one
file, and the red-line table is the machine-readable ledger). Below is a
location index only:

| Topic | Authoritative location |
| --- | --- |
| Architecture principles (cohesion/coupling, DIP, OCP, DRY-KISS-YAGNI) | `AGENTS.md` → "架构基本原则" |
| The 15 review red lines (Block-level; cite by number) | `AGENTS.md` red-line table (number → summary → home) |
| Frontend import/export firewall | `src/AGENTS.md` → "模块导入/导出规范" |
| Frontend state management, React performance | `src/AGENTS.md` → "前端架构约定" |
| Backend command layer, errors & concurrency | `src-tauri/AGENTS.md` → "Rust 命令层约定", "错误与并发" |

> Before 2026-09-25 this guide restated all of the above and demonstrably drifted
> (the stale copy described `pnpm lint` wrong and listed an outdated frontend
> tree), so it is now an index. Add new conventions to the owning file — never a
> copy here.

## Test-Driven Development

The Red → Green → Refactor loop, the per-layer coverage baseline (pure functions /
Rust managers / hooks / components) and the hard constraints (no code without
tests; tests independent and < 100ms each) live in [`AGENTS.md`](./AGENTS.md) →
"TDD 开发模式" — the single source of truth, not restated here.

All new features and bug fixes in this repo must follow that loop; bug fixes start
with a regression test.

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
**`lefthook.yml` owns the hook list** (table below is an overview):

| Hook | Trigger | Runs |
| --- | --- | --- |
| `pre-commit` | changed `src/**/*.{ts,tsx,js,jsx}` | `pnpm lint:fe` |
| `pre-commit` | changed `src-tauri/**/*.rs` | `pnpm lint` |
| `pre-commit` | changed `tools/java-host/**` | `pnpm lint:host` |
| `pre-commit` | every commit | `pnpm guards run --stage commit --staged` |
| `commit-msg` | every commit | `pnpm commitlint` |

### Adding a guard

The guard list **is** the directory `tools/guards/checks/` — dropping a module
there registers it, and none of `package.json`, `ci.yml` or `lefthook.yml` needs
to change (three hand-copied lists is exactly how the local and CI gate sets
drifted apart before). A module exports two things:

```python
GUARD = Guard(id="check_my_rule", title="…", scopes=("src/**/*.ts",),
              stages=("local", "ci", "commit"), red_lines=(8,), fix_hint="…")

def check(ctx: Context) -> GuardResult: ...   # returns findings, never prints
```

The framework enforces the parts every guard used to re-invent badly:

- **no vacuous pass** — `scanned == 0` is reported as *the guard itself broke*
  (exit 2), not as a pass; the repo root is resolved in one place by marker,
  never by `parents[N]`;
- **a companion test is mandatory** — `tests/test_<id>.py` must exist, and the
  guard suite runs before any verdict is printed;
- **exit codes are distinguished** — 0 pass / 1 violation / 2 guard error, so a
  broken tool can never masquerade as "checked". A broken guard also raises a CI
  `::warning::`, because a guard that silently died would otherwise hide inside
  a collapsed log group;
- **every guard has a time budget** (`budget_ms`, default 10s) — a gate slow
  enough that nobody runs it is a gate that has disappeared, so overrunning it
  is reported as *guard error*, not as a code violation.

`pnpm guards list` prints the live registry; `pnpm guards list --stage ci` shows
exactly what CI gates on (and names any guard left out — the local/CI gate sets
drifted apart precisely because no command could answer that before);
`pnpm guards list <id>` dumps that guard's ledger.

**Stage a guard together with its test.** `lefthook run pre-commit` evaluates the
*staged* tree, so staging `tests/test_check_x.py` while `core/…` or
`checks/check_x.py` stays at an older revision makes the hook run new tests
against the old framework — it will fail with something that looks like a code
bug but is really a split snapshot.

A commit is blocked until all gates pass. Before opening a PR, run the **minimal
regression set** locally — its definition lives in [`AGENTS.md`](./AGENTS.md) →
"Development Commands" (single source of truth, not restated here).

## Testing Requirements

The per-layer coverage baseline lives in [`AGENTS.md`](./AGENTS.md) → "TDD 开发模式";
the frontend test framework, directory layout and mock strategy live in
`src/AGENTS.md` → "测试".

This guide keeps only the rule that has no other home:

- Use `tempfile` for Rust tests that touch the filesystem, and **never** write to
  the real `~/.neeko` config in tests.

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
publish a GitHub Release with installers. Only maintainers with push access run
releases.
