# fix: git status list stale after build (race in full refresh)

## Bug

文件列表的 git status 标记在 build 之后失效/陈旧。复现路径：在 Neeko 终端里跑 `pnpm tauri build` / `npm run build` 等产生大量文件改动的命令，结束后文件树里本应标记为 Modified/Added 的文件仍显示旧状态（或无状态）。

## Root Cause

两个独立但叠加的缺陷：

1. **全量刷新存在陈旧覆盖竞态（核心）**：`src/features/session/hooks/useSessionBootstrap.ts` 监听后端的 `git-changed` 事件，每次都用 `void refreshGitFileStates(...)` 触发一次全量 `get_worktree_changed_files` + `get_ignored_files`（两个 `git2 spawn_blocking` 调用）。Build 期间事件高频爆发，多个请求并发进行：较慢的早发请求可能在较快的晚发请求之后才完成并 `setState`，把 `changed_files` 覆盖成 build 中期的快照。Build 结束后事件停发，文件列表停留在陈旧状态。
2. **构建产物目录未过滤（放大器）**：`src-tauri/src/common/file/watcher.rs` 的 `should_ignore_path` 仅忽略 `.git` / `node_modules` / `target` / `.DS_Store`。Vite/Next/Nuxt 的 `dist` / `build` / `.next` / `out` / `coverage` 目录在 build 期间会被 notify 监听到，每次 Create/Modify 都会触发 debounced file-changed 事件，进而进入 `refreshGitFileStates` 风暴。这放大了竞态的窗口。

## Requirements

1. **G1 (P0) 并发陈旧覆盖防护**：`refreshGitFileStates` 必须保证当同一 `projectId` 上有更新的调用处于 in-flight 或已发出时，较早调用的结果不覆盖 `changed_files` / `ignored_files`。
2. **G2 (P0) 不破坏现有行为**：现有四个 `refreshGitFileStates` 测试（正常 patch、worktree 路径透传、get_ignored_files 失败回退、changed_files 失败静默）必须全部通过。
3. **G3 (P1) 构建产物目录忽略**：`should_ignore_path` 必须忽略常见前端/构建产物目录的**路径组件名**：`dist`、`build`、`.next`、`out`、`coverage`。（与现有的 `.git` / `node_modules` / `target` / `.DS_Store` 一致的 component-name 匹配风格。）
4. **G4 (P1) 健壮性**：修复不得引入 try/catch 吞噬外的额外吞错；`setState` 被跳过属于正常并发控制，不是错误。
5. **G5 (P2) 范围最小**：仅改动与本 bug 直接相关的文件。不重构 `refreshGitFileStates` 内部结构，不改 store schema，不动 git status worker。

## Acceptance Criteria

- [ ] AC1 新增测试 `并发刷新时仅最新一代的全量快照生效，陈旧请求的结果被丢弃`（位于 `src/features/git/utils/__tests__/gitStatus.test.ts`）— **已写入（红）**。
- [ ] AC2 `src/features/git/utils/gitStatus.ts` 的 `refreshGitFileStates` 实现 per-project generation token：模块级 `Map<projectId, number>`；进入时 `myGen = (map.get(id) ?? 0) + 1`；`await Promise.all` 之后若 `map.get(id) !== myGen` 则 `return`（跳过 `setState`）。
- [ ] AC3 `src-tauri/src/common/file/watcher.rs` 的 `should_ignore_path` 在现有匹配集中新增 `dist` / `build` / `.next` / `out` / `coverage` 五个组件名。
- [ ] AC4 新增 Rust 单元测试覆盖 `should_ignore_path` 的新增条目（至少验证每个新目录名被识别为 ignored）。
- [ ] AC5 所有现有测试通过；`pnpm type-check` 通过；`cargo test` 通过。

## Non-Goals

- 不做 `git-changed` 监听器去抖/节流（generation token 已保证正确性；去抖是独立优化，非本 bug 必需）。
- 不改 git status worker / diff 计算逻辑。
- 不改 store / 类型 schema。

## Files to Touch

- `src/features/git/utils/gitStatus.ts` — 加 generation token
- `src-tauri/src/common/file/watcher.rs` — `should_ignore_path` 新增目录

## Notes

- TDD：AC1 测试已写入且当前应失败（红）。Green 实现 = AC2 + AC3。
- 生成 token 用模块级 `Map`（按 projectId 隔离），按当前活跃任务数量有界，无需清理。
- `should_ignore_path` 现有匹配的是**路径组件名**（`path.file_name()`），新加的目录名按此风格追加。
## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.
