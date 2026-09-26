# Neeko 后端（`src-tauri/`）开发规则

> **根文件硬指令：改 `src-tauri/**` 前必须读本文件**（工具不会总是自动注入）。跨栈规则在仓库根
> `AGENTS.md`（红线表列出各自落点）；前端规则在 `src/AGENTS.md`。红线编号与根文件索引一一
> 对应。机制细节与事故记录在 `.trellis/spec/backend/`，本文只保留祈使句与判据。

## 模块布局

`src-tauri/src/` 按域分模块，每个域是 `commands.rs`（或 `commands/`）+ `services.rs`/`manager.rs` + `mod.rs`：

`src-tauri/src/main.rs`（入口）· `lib.rs`（模块聚合 + `neeko_invoke_handler!`）· `app.rs`（Builder 组装）·
`app_state.rs`（`AppStateWrapper`）· `common/`（error/logger/executor/utils…）· `core/`（exec/runtime/project）·
`platform/`（平台适配器集中层）；其余按域分目录，清单以 `ls src-tauri/src` 为准 ——
**2026-09-25 核对**：旧副本列的 `skill/` 已不存在，`about/` `library/` `search/` 未在列，故删除副本。

完整树状与职责：`docs/ARCHITECTURE.md`、`.trellis/spec/backend/directory-structure.md`。

## 主链路

`main.rs` → `neeko_lib::run` → `app.rs` 组装：初始化日志与 PATH → 注入 `SkillStore` 与
`AppStateWrapper` → setup 阶段恢复 session、启动 watcher、加载自定义 agent → 注册命令处理器。

命令注册单一事实源是 `lib.rs` 的 `neeko_invoke_handler!`；`app.rs` 保持
`.invoke_handler(crate::neeko_invoke_handler!())` 固定调用。

## 架构要点（终端 / SSH / 持久化）

- **PTY 会话在组件卸载时保持存活**（DOM detach/reattach），不要把进程生命周期绑到 React 挂载周期。
- **终端缓存 key 的唯一实现处**是前端 `src/features/terminal/components/terminalCache.ts` 与
  `terminalTabCleanup.ts`（形如 `wsl:{distro}:{projectId}:{tabId}:p{n}`、
  `{projectId}:wt:{path}:{tabId}:{paneId}`）。**以代码为准，勿在文档维护副本** —— 旧根文档写的
  `:side` 后缀与 `{projectId}:wt:{worktreePath}` 两段式在仓库中已不存在（2026-09-25 核对），
  而 `docs/ARCHITECTURE.md` 与旧文档当时已经互相矛盾。
- **SSH IO**（`terminal/remote.rs`）：`channel.make_writer()` 分离读写，`tokio::select!` 三路并发
  —— input: `input_rx` → writer；resize: `resize_rx` → `channel.window_change()`；
  output: `channel.wait()` → emit `terminal-output-{id}`。事件名受根文件红线 5 约束。
- **持久化**：`~/.neeko/sessions.json`（项目、WSL、SSH、宽度、Worktree 状态）与
  `~/.neeko/config.json`（字体、Diff 模式、Shell、IDE/Agent 覆盖）。
- 旧根文档记载的「Agent 自动启动延迟：本地即时 / WSL 500ms / SSH 800ms」在本次核对中**未在代码里找到
  对应常量**，故不复述；要恢复请先定位实现，不要抄文档。

## Rust 命令层约定

1. 命令函数使用 `#[tauri::command]`
2. 返回类型统一为 `Result<T, AppError>`（thiserror 枚举）
3. 错误转换使用 `.map_err(AppError::from)`
4. 状态注入使用 `State<AppStateWrapper>`
5. 异步命令优先使用 `State<'_, AppStateWrapper>`
6. AppError 覆盖：Io, Git, Storage, Skill, Project, NotFound, InvalidInput, Remote, Dap, Serde, Unknown

新增命令：域文件实现（返回 `Result<T, AppError>`）→ 域 `mod.rs` 聚合导出 → 命令路径加入
`neeko_invoke_handler!` → 补测试并跑回归。

## 错误与并发

1. manager 中共享状态使用 Mutex 或内部并发容器
2. 避免跨 await 持有锁
3. 平台特定逻辑通过 `cfg` 分支处理（受红线 10 约束，必须落在 `platform/`）
4. WSL 命令使用 `cfg!(target_os = "windows")` 门控
5. Windows 使用 `CREATE_NO_WINDOW` (0x08000000) 避免控制台闪烁

## 审查红线（后端专属）

> 违反即为 Block 级。跨栈红线不在此列 —— 落点见根 `AGENTS.md` 红线表的「全文位置」列。

**1. 统一命令执行接口（Local/WSL/SSH）** —— 命令执行必须走统一接口：`crate::core::exec` facade
（`run` / `spawn` / `spawn_with` / `collect` / `command_exists`）或 `crate::common::executor`
（`ExecTarget` + `create_executor`），按项目环境分发（`core/project.rs` 的
`ProjectEnvironment::to_exec_target()`、`common/git/transport.rs` 的 `exec_target()`）。

业务代码禁止绕开统一接口直接用 `std::process::Command` / `tokio::process::Command`。
`common/utils/command` 仅保留纯工具函数（`quote_shell_arg`、`safe_path`、`resolve_command_path`、
`resolve_full_path`、`flags`；其 Windows 分支 `local.rs::windows_command` 内部附加
`CREATE_NO_WINDOW`）与「已有 SSH channel」场景的 `ssh::exec` 辅助（`SshExecutor` 是自建连接模型，
无法复用已打开的 channel）。

基础设施豁免只有两类，且文件内必须注释说明原因 —— 清单见
`.trellis/spec/backend/quality-guidelines.md`「平台差异集中化 · 边界」。

已迁移正例参照：`common/git/transport.rs`、`common/file/services.rs`、`agent/manager.rs`、
`lsp/process.rs`。

Windows 的 `CREATE_NO_WINDOW` 语义由 `platform::process_spawn::apply_child_flags` 统一附加
（`LocalExecutor` 已内置，见 `common/executor/local.rs`）—— 迁移旧代码时**不需要**再手工补
creation flags，重复附加反而会让平台差异离开集中层。

同步桥（`collect_blocking` / `collect_blocking_with` / `spawn_detached` /
`command_exists_blocking`）的线程语义与允许调用位置：见
`.trellis/spec/backend/concurrency-guidelines.md`「`core::exec` 的同步桥语义」。

**2. 跨平台 shell 选择** —— Local 执行路径必须区分 Windows (`cmd /c`) 与 Unix (`sh -c`)。正确参照
`terminal/mod.rs` 的 task-command 分支（`#[cfg(target_os = "windows")]` → `cmd` /
`#[cfg(not(...))]` → `sh`）。禁止在任何 `ExecTarget::Local` 路径中无条件硬编码 `sh -c` 或 `bash -lc`。

**3. 阻塞 I/O 隔离** —— 异步 Command 中禁止直接调用 `std::fs::*`、`std::process::Command` 或
portable-pty 阻塞读写，必须包裹进 `tokio::task::spawn_blocking`。参照 `core/exec.rs`、
`lsp/manager.rs` 的既有用法。

**6. Command 层保持极薄** —— `#[tauri::command]` 只做参数接收 + 反序列化校验 + 调度
manager/service，禁止在 Command 内部平铺 Git、SSH、PTY 核心控制逻辑。委派写法与原因见
`.trellis/spec/backend/command-guidelines.md`「命令边界的两条硬约束」。

**7. `if let` 嵌套不超过 3 层** —— 连续 3 层及以上 `if let` / `if let else if` 必须拍平为单个
`match`；反向，仅 1-2 个 happy path 的解构优先 `if let`，禁止写出带 `_ => {}` 占位的 `match`。
理由与样例见 `.trellis/spec/backend/quality-guidelines.md`「禁止模式 5」。

**8. 路径安全校验** —— 前端传入的路径（IDE 路径、项目 Root、文件操作路径）在 Rust 端消费前必须
`canonicalize()`，严防路径穿越。`capabilities` 配置禁止放开 `fs:allow-all`、`shell:allow-all`
（见 `.trellis/spec/security/allowlist.md`）。

**9. `mod.rs` 保持极薄** —— `mod.rs`（或同名根文件）只允许 `mod` 声明与 `pub use` re-export。
业务 `fn`、`impl` 块、结构体字段实现必须抽离到同级独立文件（`services.rs`、`manager.rs`、`types.rs`）。

**10. 平台代码规范化（Platform Adapter）** —— 跨平台差异与单平台专属代码（macOS-only / Windows-only /
Linux-only）必须抽入 `src-tauri/src/platform/<theme>/`：`mod.rs` 用 `#[cfg]` 门控 + `pub use`
（保持纯声明），非目标平台提供同签名默认 stub（`Ok(None)` / no-op，**必须为 `const fn`** 以满足
clippy `missing_const_for_fn`），业务代码无条件调用统一接口。

禁止在通用文件（`commands.rs` / `manager.rs` / 根级模块）内平铺 `#[cfg]` 块或保留未门控的平台专属
import —— 未门控会在非目标平台触发 `unused_imports`，被 clippy `-D warnings` 升级为 CI 错误。
**完整模式、反模式与历史豁免撤销：`.trellis/spec/backend/quality-guidelines.md`「平台差异集中化」。**

**11. 换行边界（Line-Ending Boundary）** —— Git 客户端同时面对「git 归一化视图」（blob/diff/status，
受 `text`/`core.autocrlf` 影响时统一 LF，**确定**）与「工作区物化字节」（由平台 + git 配置决定，
Windows 默认 `autocrlf=true` 会转 CRLF，**不确定**）。

- **生产**：禁止向 git 调用注入 `-c core.autocrlf=...` / 强制换行语义改变用户仓库行为，必须尊重用户
  仓库设置；工作区字节按不透明平台数据处理，解析走 `.lines()` 等 CRLF 兼容路径。
- **测试**：禁止对工作区换行做字节级精确断言（`read_to_string` + `assert_eq!` 在 Windows CI 必挂）。
  测试仓库必须用确定性 builder（`tests/unit/support.rs::TestRepo`、`operations.rs::init_repo`：
  仓库级 `core.autocrlf=false` + `.gitattributes * -text` 双保险）；必须断言字节时走行尾无关比较
  （`support::assert_content_eq` / `assert_worktree_eq`），或优先在归一化视图（status/diff）上断言。
  护栏：`tools/guards/checks/check_worktree_byte_assertions.py`（已接 `pnpm lint` 与 CI）。
  细则见 `.trellis/spec/unit-test/backend-testing.md`。

**13. 测试夹具路径平台无关** —— 测试中进入 `Path`/`PathBuf` 语义或路径敏感 API（`is_absolute()`、
`canonicalize()`、存在性判定）的路径字面量，**禁止硬编码 POSIX 绝对路径**（`/opt/…`、`/home/…`、
`/tmp/…`）：Windows 上无盘符前缀 `is_absolute()` 恒 false，本地绿而 Windows CI 红。一律由 `tempdir()`
推导平台绝对路径。纯字符串语义（JSON 载荷、URL query、转义拼接、平台无关断言）不受限。

执行方式：本红线无稳定语法指纹（静态 grep 实证 45+ 文件合法命中，脚本化信噪比不可接受），由
**AI 审查对 diff 内夹具路径字面量专项检查**，唯一可靠判定是 CI 的 Windows `cargo test` job。
已踩样例见 `.trellis/spec/backend/dap-domain.md` 反例表。

**15. 语言差异必须落在插件数据** —— LSP 的语言差异（会话根范围、检测压制、调优开关、安装方式、能力
声明）一律作为 `LspPlugin` 字段声明，**禁止**在通用模块（`lsp/session/*`、`manager.rs`、`profile.rs`、
`plugin/registry.rs`、`plugin_manager.rs`）写 `language_id == "xxx"`、语言白名单或按语言 `if`/`match`。

改通用模块需要知道「这是哪种语言」时，先问「这条知识能不能作为插件字段携带」。字段清单、消费点与
三条护栏测试见 `.trellis/spec/backend/lsp-domain.md`「语言差异必须落在插件数据」。
