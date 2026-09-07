# 修复文件树路径安全与异步 I/O 隔离

## Goal

修复二轮审查发现的 2 个 Block 级问题，并继续修复二轮审查剩余 6 个 Warning，同时保持 WSL / Remote gitignore 功能与 Local 文件树行为不回退。

## Background

- Local `read_dir_tree()` 已经通过 `validate_within_root()` 做路径校验，但读取动作直接调用 `std::fs` 递归扫描，运行在 async 路径中。
- WSL / Remote `read_dir_tree()` 将 `root_path` 与前端传入的 `sub_path` 直接拼接；`safe_path()` 只负责 shell 转义，不能阻止 `../../` 穿越到项目根之外。
- WSL / Remote 的 ignored 目录标记与剪枝是本次既有变更的核心功能，不允许在安全修复中回退。

## Requirements

1. 对 WSL / Remote 的 `sub_path` 增加显式路径校验：
   - 禁止绝对路径；
   - 禁止 `..` 路径段；
   - 禁止空路径段、`.`、Windows 反斜杠与 NUL；
   - 校验通过后才拼接 `root_path` 并执行远程命令。
2. Local `read_dir_tree()` 的目录扫描必须放入 `tokio::task::spawn_blocking`，async driver 不直接执行阻塞文件 I/O。
3. `GitIgnoreFilter` 继续作为 Local 文件树读取的唯一 ignored 语义来源，保持读前剪枝与 `ignored` 标记。
4. WSL / Remote 的 `fetch_remote_ignored_paths()`、`apply_ignored_to_tree()` 与 `build_git_ignored_command()` 行为不回退。
5. 远程 ignored 路径解析必须有容量上限，避免异常仓库 / 异常输出造成无界内存与 IPC 负担。
6. WSL / Remote ignored 路径查询必须具备按项目与环境 / 根目录维度的缓存，并提供 TTL 与 watcher 失效机制，避免每次读树重复执行全仓查询，同时不得造成 ignored 标记 / 剪枝长期过期。
7. watcher Selective 注册降级测试必须真正传入 git 项目使用的 `GitIgnoreFilter`，覆盖 `Some(&filter)` 状态机。
8. `useGitPerfSuggestion.ts` 的 IPC payload 类型迁移到 `src/shared/types/git.ts`，消除手写重复契约。
9. watcher 生产路径不得使用 mutex `expect()`，锁异常必须优雅降级。
10. `detect_perf_suggestions()` 完整阈值链路必须有直测，覆盖小仓库与大仓库启用 / 未启用配置。

## Acceptance Criteria

- [x] 新增回归测试覆盖远程 `sub_path` 风险输入：`../../etc`、绝对路径、反斜杠、空段。
- [x] 新增测试覆盖合法远程 `sub_path`（如 `src/sub`）可被接受。
- [x] Local 目录树读取通过 blocking 线程执行；`read_dir_tree()` 在 Tokio 运行时中仍返回正确树。
- [x] 既有 Local / Remote / WSL 文件树与 gitignore 相关测试全部通过。
- [x] `cargo fmt --check`、`cargo clippy -D warnings`、相关 `cargo test` 通过。
- [x] 不提交代码；提交动作由用户决定。
- [x] 新增 `parse_remote_ignored_output()` 行为测试：正常解析、去重、容量截断与超限告警。
- [x] `fetch_remote_ignored_paths()` 接入容量上限解析。
- [x] 新增 remote ignored 缓存测试：首次查询后命中缓存、TTL 过期重查、显式失效后重查。
- [x] `read_dir_tree()` WSL / Remote 使用缓存；命令层传入项目维度缓存 key。
- [x] watcher 检测 `.gitignore` / `.git/info/exclude` 变化与 `unwatch()` 时清除对应缓存。
- [x] Selective 降级测试改用真实 `.gitignore` + `Some(&filter)`，保持状态机断言不回退。
- [x] 新增 shared `GitPerfSuggestion` / `GitPerfSuggestionEvent` 类型，Hook 直接导入 shared 契约。
- [x] watcher mutex 失败路径改为 `warn!` + 返回 / `break`，生产代码移除对应 `expect()`。
- [x] 新增 `detect_perf_suggestions()` 阈值链路测试，覆盖小仓库、大仓库未启用与大仓库启用。
- [x] `cargo fmt --check`、`cargo clippy -D warnings`、相关 / 全量测试、前端 typecheck / vitest / eslint 通过。
