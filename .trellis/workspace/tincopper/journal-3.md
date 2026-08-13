# Journal - tincopper (Part 3)

> Continuation from `journal-2.md` (archived at ~2000 lines)
> Started: 2026-08-05

---



## Session 118: fix: 根目录新建输入行缩进对齐

**Date**: 2026-08-05
**Task**: fix: 根目录新建输入行缩进对齐
**Branch**: `main`

### Summary

修复 FilesPanel 根目录新建输入行 indent 硬编码 16→4，与 depth=0 树节点对齐，消除提交后 12px 视觉跳跃

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `f54eb7c4` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 119: 浏览器按项目隔离 + dock 切换决策

**Date**: 2026-08-06
**Task**: 浏览器按项目隔离 + dock 切换决策
**Branch**: `main`

### Summary

浏览器按项目隔离:每项目独立 webview(label=neeko-browser-{projectId})、事件 payload 带 label 过滤、store 按 projectId 索引;新增 decideProjectSwitchDock 纯函数,项目未开启浏览器时切换不展示空面板、已开启时切回自动恢复并保持布局;新增 20 个测试,修复 zustand action 命名冲突

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `4a84fd53` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 120: 浏览器模块审查修复(browser-module-audit-fixes)

**Date**: 2026-08-06
**Task**: 浏览器模块审查修复(browser-module-audit-fixes)
**Branch**: `main`

### Summary

完成 9 个子任务:事件常量抽取、open-external 去除 cmd 注入面、file:// 白名单、picker fetch POST 通道(>100KB round-trip)、useTauriEvent 抽取、PICKER_SCRIPT 独立文件、历史栈/canGoBack、标题/favicon、webview 回收。质量套件全绿(前端 1184 测试 + Rust 688 测试),9/9 归档

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `f73762ac` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 121: 修复 build 后 Cmd+W 关闭 tab 失效与 Agent 进程残留

**Date**: 2026-08-07
**Task**: 修复 build 后 Cmd+W 关闭 tab 失效与 Agent 进程残留
**Branch**: `main`

### Summary

(Add summary)

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `638fceaf` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 122: fix: reap detached process trees on PTY close (cmd+w agent leak)

**Date**: 2026-08-07
**Task**: fix: reap detached process trees on PTY close (cmd+w agent leak)
**Branch**: `main`

### Summary

新增 Unix 进程树收割器 process_reaper.rs（macOS libproc / Linux procfs），close_pty_handle 先快照后杀 shell 再收割脱离 setsid 的孤儿进程；发现并修复快照时序缺陷（shell reap 后 ppid 链断裂致收割失效），补回归测试；cargo check / clippy -D warnings / 全量 79 tests 通过；任务已归档至 archive/2026-08/

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `ba5b0b93` | (see git log) |
| `7a6930ec` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 123: feat(editor): drag unpinned tab to pinned panel to pin

**Date**: 2026-08-07
**Task**: feat(editor): drag unpinned tab to pinned panel to pin
**Branch**: `main`

### Summary

(Add summary)

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `4169970f` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 124: feat(editor): multi pinned tabs — drag tab to pinned panel appends instead of replacing

**Date**: 2026-08-07
**Task**: feat(editor): multi pinned tabs — drag tab to pinned panel appends instead of replacing
**Branch**: `main`

### Summary

(Add summary)

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `4169970f` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 125: fix: git status list stale after build (race in full refresh)

**Date**: 2026-08-07
**Task**: fix: git status list stale after build (race in full refresh)
**Branch**: `main`

### Summary

Watcher now ignores build-output dirs (dist/build/.next/out/coverage); refreshGitFileStates gated by per-project generation token; race test rewritten to be deterministic. Specs updated (state-management scenario, FE vacuous-test forbidden pattern, backend watcher-ignore convention). Code uncommitted per safety (no work-commit hashes this session). Check sub-agent: PASS.

### Main Changes

# Session: fix: git status list stale after build (race in full refresh)

## Bug
After `pnpm tauri build` (or any heavy build), the file list's git-status indicators stop updating correctly. Cause had two layers:

1. **Event flood**: notify watcher was forwarding thousands of Create/Modify events from build-output dirs (`dist/`, `build/`, `.next/`, `out/`, `coverage/`) during the build, amplifying the `git-changed` event rate.
2. **Race in full refresh**: `refreshGitFileStates` was called fire-and-forget on every `git-changed`. Under the flood, backend responses arrived out of order; the later-arriving stale response called `useProjectStore.setState` with an old snapshot, overwriting the newer one — the file list's git status appeared to "regress" or go stale.

## Fix
- `src-tauri/src/common/file/watcher.rs` — extended `should_ignore_path` to also ignore build-output dirs (`dist`, `build`, `.next`, `out`, `coverage`) on top of the pre-existing `.git / node_modules / target / .DS_Store`. Mitigation (reduces event volume), not the root-cause fix.
- `src/features/git/utils/gitStatus.ts` — `refreshGitFileStates` now uses a per-project monotonic generation counter (`refreshGenerations: Map<projectId, number>`). Each call bumps its generation, awaits the backend calls, and discards the result if the stored generation has moved on. Root-cause fix: stale out-of-order responses are dropped before they can `setState`.
- `src/features/git/utils/__tests__/gitStatus.test.ts` — race test rewritten to be **deterministic**. The old test relied on microtask FIFO ordering (`A`'s setState after `B`), which is a vacuous test: `.catch()` / `.finally()` inject extra microtask hops so unfixed code coincidentally passes (false GREEN). New test makes the *earlier* setState callback actively resolve the later-arriving promise, forcing the later setState onto a subsequent microtask round and deterministically exposing the ordering bug. Regression gate: removing the generation guard must turn the test RED; restoring it returns it to GREEN.

## Verification
- `cargo test --manifest-path src-tauri/Cargo.toml watcher` — pass.
- `pnpm test:run gitStatus` — pass (after rewrite: RED on unfixed code, GREEN on fixed code).
- Sub-agent `trellis-check` — PASS (gated quality check across both layers, with recommended test rewrite applied).

## Spec updates
- `.trellis/spec/frontend/state-management.md` — new dated scenario **"异步全量刷新防陈旧覆盖 (git status 竞态) 2026-08-07"** (7 sections: Scope/Trigger, Signatures, Contracts, Validation/Error Matrix, Good/Base/Bad Cases, Tests Required, Wrong vs Correct). Documents the generation-token pattern as a reusable contract.
- `.trellis/spec/frontend/quality-guidelines.md` — new forbidden pattern **"### 6. 异步竞态测试依赖微任务顺序(假 GREEN)"**. Captures the microtask-FIFO vacuous-test trap so future sessions don't repeat it.
- `.trellis/spec/backend/quality-guidelines.md` — new required pattern **"### 7. 文件监听器必须忽略构建产物目录"**. Documents `should_ignore_path` as the project-wide convention for build-output dirs; when adding a new monorepo package's build dir, consult the function first.

## Finish-work
- `task.py archive 08-07-08-07-fix-git-status-race` → archived to `archive/2026-08/`, auto-committed `chore(task): archive ...`.
- **Code commit (Phase 3.4) intentionally skipped** per global safety rule (禁止自动提交). The 6 modified files (3 spec MDs, `watcher.rs`, `gitStatus.ts`, `gitStatus.test.ts`) remain in the working tree for the user to review and commit. This session produced no work-commit hashes; the journal records the situation in --summary.


### Git Commits

(No commits - planning session)

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 126: 平台差异集中化重构：neeko-check 审查 + 三项优化 + 提交

**Date**: 2026-08-11
**Task**: 平台差异集中化重构：neeko-check 审查 + 三项优化 + 提交
**Branch**: `main`

### Summary

对平台差异集中化重构执行 neeko-check 审查（PASS）；落实三项优化：notify_base 命名改回函数式、ProcessTree 类型别名抽离至 types.rs、shell_launch 补充单元测试；全量测试/clippy/fmt 通过；英文 Conventional Commits 提交；任务归档。

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `7ea9ae42` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 127: 收敛命令执行三重枚举（GitTransportKind/ExecTarget/ProjectEnvironment）

**Date**: 2026-08-11
**Task**: 收敛命令执行三重枚举（GitTransportKind/ExecTarget/ProjectEnvironment）
**Branch**: `main`

### Summary

删除 GitTransportKind，GitTransport 直接 impl for ExecTarget，删除 exec_target() 泄漏方法与 to_git_transport() 双向转换，resolve_project 返回 ExecTarget。三重枚举收敛为二重，行为零变化，677+79 测试全绿。

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `e45d9b57` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 128: Fix markdown link crash + global error guard

**Date**: 2026-08-12
**Task**: Fix markdown link crash + global error guard
**Branch**: `main`

### Summary

Fixed MarkdownPreview internal-link webview navigation crash (preventDefault + resolveInternalHref + open via onFileSelect; mailto/tel/anchor defaults preserved). Added global error guard: window.onerror/unhandledrejection/ErrorBoundary throttled toast + log_frontend_error to ~/.neeko/neeko.log. Reviewed via neeko-check, optimized findings (Rust test authenticity, link protocol handling), all quality gates passed.

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `7e0acd41` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 129: 清理前端静态吞错并接入全局错误上报

**Date**: 2026-08-12
**Task**: 清理前端静态吞错并接入全局错误上报
**Branch**: `main`

### Summary

将 reportFrontendError 下沉至 shared/utils/errorReporting.ts（setErrorNotifier 解耦 + async 内部吞错），删除 errorApi.ts；改造 16 文件 36 处 .catch(() => {}) 接入日志上报，11 处高频/剪贴板/链保活/回滚保留静默并加豁免注释。lint:fe/type-check/cargo lint 全绿，1438 测试通过。

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `9bf3546b` | (see git log) |
| `5ee2bf2a` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete


## Session 130: 08-13 AI diff review: frontend integration stages 5-6

**Date**: 2026-08-13
**Task**: 08-13 AI diff review: frontend integration stages 5-6
**Branch**: `main`

### Summary

DiffView review integration (popover/anchors/selection), ReviewPanel dock panel, reviewStore instruction extension, type fixes (selectionMapping feature DiffHunk, dock barrel REVIEW_PANEL_ID, ReviewPhase/iconClass cleanup, progress payload reviewId); 30 scoped tests green; tsc clean.

### Main Changes

(Add details)

### Git Commits

(No commits - planning session)

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete
