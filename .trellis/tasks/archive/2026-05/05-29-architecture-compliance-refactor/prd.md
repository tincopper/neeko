# Architecture Compliance Refactor

Align codebase with `docs/neeko-development-spec.md` specification.

## Background

Audit found **16 gaps** across 4 severity tiers. Spec covers:

- §1 全局设计哲学 (Domain Alignment, 单向依赖流, 单向代码流)
- §2 全栈目录树 (Feature-Based structure with api/, services/, repository/)
- §3 前端 ESLint 架构约束 (no-restricted-paths, no-cycle, import/order, naming)
- §4 Rust Clippy 架构约束 (lints config, deny attributes, visibility conventions)
- §5 全栈数据流 (Zustand → API → invoke → Command → Service → Repository → DB)
- §6 全栈分层职责 (models, repositories, services, commands)
- §7 高压线 (横向隔离, 桶文件, 错误冒泡, HashRouter, 命名规范)

## Sub-tasks

| # | Task | Severity | Est. |
|---|------|----------|------|
| 1 | Quality Infrastructure — ESLint + Clippy | P0 | 1-2d |
| 2 | Backend Layering — core/ + services/repository | P0-P1 | 3-5d |
| 3 | Frontend Layering — api/ + import isolation | P0-P1 | 3-5d |
| 4 | Eliminate unwrap() — ? + AppError | P2 | gradual |

## Dependency order

Phase 1 (quality gates) must complete first so subsequent phases have lint enforcement.
Phases 2-4 can run in parallel after Phase 1.

## Completion criteria

- [ ] `pnpm lint` covers both ESLint (src/) and cargo clippy
- [ ] Backend domains have services.rs / repository.rs where applicable
- [ ] `src-tauri/src/core/` exists with error.rs, logger.rs, db.rs
- [ ] All 12 feature modules have api/ subdirectory
- [ ] Zero shared/ → features/ imports
- [ ] Zero direct invoke() in components
- [ ] Zero unwrap() in production code (or deny lint active)
- [ ] Directory naming: kebab-case for non-component dirs
