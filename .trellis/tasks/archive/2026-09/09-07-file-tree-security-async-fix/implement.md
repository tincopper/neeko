# 执行计划

## Checklist

1. [x] 阅读 `services.rs` 当前实现与既有测试。
2. [x] Red：新增远程 `sub_path` 校验测试，覆盖穿越与合法路径。
3. [x] 运行相关测试，确认失败原因符合预期。
4. [x] Green：实现 `validate_remote_sub_path()` 并接入 WSL / Remote 分支。
5. [x] Red/Green：为 Local async `read_dir_tree()` 增加行为回归测试，确认当前阻塞 I/O 修复后仍正确。
6. [x] Refactor：将 Local `read_dir_recursive()` 移入 `tokio::task::spawn_blocking`。
7. [x] 运行 `cargo fmt --check`、`cargo clippy -D warnings`、相关测试。
8. [x] 复核 WSL / Remote gitignore 功能未回退。
9. [x] Red：新增 remote ignored 输出解析容量测试，确认解析函数缺失 / 未限流失败。
10. [x] Green：抽取 `parse_remote_ignored_output()` 并接入 `fetch_remote_ignored_paths()`。
11. [x] Red：新增 remote ignored 缓存行为测试，确认未缓存时重复查询、显式失效不生效。
12. [x] Green：实现 TTL 缓存、命令层 project_id、watcher / unwatch 失效。
13. [x] Refactor：改造 Selective 降级测试为 `Some(&filter)` 真实分支覆盖。
14. [x] Red：为 `detect_perf_suggestions()` 增加完整阈值链路测试，确认链路问题暴露。
15. [x] Green：必要时修正阈值链路，保持测试通过。
16. [x] Refactor：消除 watcher 生产 mutex `expect()`，迁移前端 perf IPC 类型。
17. [x] 复跑后端与前端质量基线；不执行 commit / push。

## Validation Commands

```bash
cargo test --manifest-path src-tauri/Cargo.toml common::file::services::tests
cargo fmt --manifest-path src-tauri/Cargo.toml --all -- --check
cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml
./node_modules/.bin/tsc --noEmit
./node_modules/.bin/vitest run
./node_modules/.bin/eslint src/
git diff --check
```

## Rollback

- 若修复引入回归，优先回退 `src-tauri/src/common/file/services.rs` 中本次新增的校验函数与 `spawn_blocking` 包装。
- 不回退既有的 WSL / Remote gitignore 功能文件与测试。

## Follow-up Review Fixes

1. [x] Red：新增 in-flight remote ignored cache 失效竞态测试。
2. [x] Green：引入项目级 cache generation，fetch 返回时校验 generation 后才允许写入。
3. [x] Red：新增目录删除 stale 注册清理测试。
4. [x] Green：新增 `RemoveDir` 维护消息，删除 / 重命名路径会清理自身与子孙注册。
5. [x] Red：新增 Selective 注册触顶测试。
6. [x] Green：触顶时降级 recursive 注册，避免静默丢失新增目录监听。
7. [x] Green：`count_tracked_files()` 改读 git index entry count，避免缓冲完整 `git ls-files` stdout。
8. [x] Green：`stop_all()` 与 `unwatch()` 一致地失效 remote ignored cache。
9. [x] Cleanup：移除 `useSessionBootstrap` 测试中已退役 API 的残留 mock。
10. [x] Green：file 命令层的 `root_path` 为 Some 时复用 worktree 路径校验，防止穿越 / NUL 输入。
11. [x] Refactor：消除 `rename_path()` 中重复的 target 绑定。
12. [x] Red：新增并发同 key remote ignored cache miss 测试，验证重复 fetch 问题。
13. [x] Green：实现 per-key `Arc<tokio::sync::Mutex>` single-flight；fetch 前二次读取缓存，fetch 后按 generation 回写，锁释放后清理无等待者的 lock map。
14. [x] Red：新增 facade 与 `WatchStrategy::for_platform()` 一致性测试。
15. [x] Refactor：新增 `platform::watch_strategy` 统一 `watch_selectively()` 接口，Linux selective / macOS+Windows recursive；`registration.rs` 移除函数体内平台 cfg，并同步 platform 主题索引。
16. [x] Red：新增 watcher 路径分类测试，锁定内容事件丢弃 gitignored 路径、结构事件保留 gitignored 路径。
17. [x] Green：拆分 `relevant_event_paths()` / `structure_event_paths()`，Create / Remove / Rename 的 ignored 变更触发文件树定向刷新，但不驱动 git worker。
18. [x] Refactor：`.git` / `.DS_Store` 硬噪声判定收敛到 `GitIgnoreFilter` 模块，manager 复用单一实现。

## Execution Result

- `parse_remote_ignored_output()` 已接入 `fetch_remote_ignored_paths()`，输出解析在 100,000 条处截断并 `warn!`。
- Remote ignored 缓存 key 为 `project_id + target_id + root_path`，TTL 30 秒；watcher 规则变化与 `unwatch()` 会显式失效。
- `WatcherManager` / registration 生产 mutex `expect()` 已改为优雅降级；Selective 降级测试覆盖 `Some(&filter)`。
- `GitPerfSuggestion` / `GitPerfSuggestionEvent` 已迁移到 `src/shared/types/git.ts`。
- `detect_perf_suggestions_with_count()` 补齐阈值 + 配置链路测试；`count_tracked_files()` 补充真实 git index 计数测试。
- 已验证：cargo fmt / clippy、`common::file`、`common::git`、unit tests、`tsc`、全量 vitest、eslint。
- 全量 lib 测试仅剩 5 个既有沙箱限制失败（MCP HTTP、LSP RSS、git_meta real-fs 3 个），与本次改动无关。
- Follow-up Review Fixes 已验证：cache generation 阻止失效窗口 stale 回插；RemoveDir 清理 stale watcher 注册；触顶降级 recursive；tracked file 计数直接读 index；`stop_all()` 失效缓存；前端退役 mock 清理。
- Follow-up 已通过：cargo fmt / clippy、unit tests、tsc、eslint、全量 vitest、`git diff --check`。
- Follow-up L5：`resolve_base()` 已接入 file 命令层，`root_path` 只接受合法 worktree 绝对路径；合法路径与穿越输入均有直测。
- Follow-up L2：remote ignored cache single-flight 已完成，8 并发同 key miss 仅触发 1 次 fetch；in-flight 失效窗口继续通过 generation 拦截 stale 回插。
- Follow-up L1：watch 策略平台差异已集中到 `platform/watch_strategy/`，生产代码不再散布平台 cfg；Linux / macOS / Windows 语义均有测试，macOS 当前环境已验证 recursive。
- 最终回归已通过：`cargo fmt --check`、`cargo clippy -D warnings`、`cargo test --test unit`（100 passed / 1 ignored）、`tsc --noEmit`、`eslint src/`（0 errors / 1 existing third-party warning）、全量 vitest（356 files / 2871 tests passed）、`git diff --check`。
- Bugfix：文件树中新增 / 删除 / 重命名的 gitignored 节点不再被 watcher 过滤，可自动触发 `file-tree-changed` 定向刷新；内容级 ignored 变更仍保持过滤。`.git` / `.DS_Store` 仍被硬排除。
- Bugfix 验证：watcher manager 3 项新增测试、gitignore 7 项测试、file services 36 项测试、unit tests 100 项测试均通过；`cargo fmt --check` / `cargo clippy -D warnings` 通过。
