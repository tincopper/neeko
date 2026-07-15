# 优化统一命令执行器实现

## Goal

修复统一命令执行器在 Tokio runtime、双流输出、stdin EOF、SSH 数据帧和跨平台 WSL 处理上的可靠性问题，使 Local、WSL、SSH 三种目标拥有一致、可等待且不会死锁的命令执行语义。

## Background

当前 `CommandExecutor::spawn` 本身是异步接口，但高层收集函数 `exec_on` 经由 `exec_sync` 调用 `Handle::block_on`。项目中多个异步 Tauri/Git 路径直接调用该同步包装器。代码审查确认以下问题：

- `src-tauri/src/common/executor/sync.rs:27-30`：活跃 Tokio runtime 内嵌套 `block_on` 会 panic。
- `src-tauri/src/common/executor/sync.rs:33-41`：先耗尽 stdout、再读取 stderr，可能因管道背压死锁。
- `src-tauri/src/common/executor/sync.rs:31`：收集模式保留 stdin，依赖 EOF 的命令无法退出。
- `src-tauri/src/common/executor/sync.rs:43-52`：非零退出错误地统一映射为 `ExecError::Ssh`。
- `src-tauri/src/common/executor/ssh.rs:185-207`：PID 行与首段 stdout 合并在同一 SSH 数据帧时，PID 解析失败或首段输出丢失。
- `src-tauri/src/common/executor/ssh.rs:219-248`：stdin sender 关闭后 bridge 立即退出，可能截断输出并将正常结束报告为 `Killed`。
- `src-tauri/src/common/executor/mod.rs:13-29` 与 `src-tauri/src/common/executor/wsl.rs:41-53`：非 Windows WSL stub 重复且实际实现分叉。

## Requirements

### R1 — 异步收集边界

- 提供可在现有 async Tauri/Tokio 路径中直接 `.await` 的命令收集 API。
- canonical async 路径不得调用 `Handle::block_on`、创建嵌套 runtime，或阻塞 Tokio worker。
- 保留 `CommandExecutor::spawn` 与 `ExecChild` 作为流式/可写 stdin 的底层接口；不为单个调用方的特殊用法扩张底层 trait。
- 需要写入 stdin 的调用方应适配现有 `ExecChild.stdin` 生命周期：写入、关闭以发送 EOF、并发收集输出、等待退出；通用收集逻辑可以复用，但不改变 executor 的职责边界。

### R2 — 安全的 stdio 生命周期

- 无输入的收集 API 必须主动关闭 stdin，向子进程发送 EOF。
- stdout 与 stderr 必须并发读取，不能因任一流背压阻塞另一流。
- 命令输出与退出状态必须全部收集后再返回。

### R3 — 结构化输出与一致的退出语义

- executor 收集层必须提供结构化命令结果，独立保留原始 stdout、stderr 和退出码。
- 结构化收集 API 在命令成功启动并取得退出状态后始终返回 `ExecOutput`，非零退出码本身不属于执行器故障；调用方必须显式判断状态。
- 常用 `exec_on` 入口继续提供成功时返回 stdout 文本的便捷语义，并将非零退出转换为结构化命令失败错误，避免普通调用方重复解码和检查状态。
- 非零退出使用统一的结构化命令失败错误，至少包含退出码、stdout 和 stderr；不得把 Local/WSL 失败标记为 SSH 传输错误。
- SSH 连接、认证、通道等传输失败继续使用 SSH 专属错误。
- 输出层不得强制所有内容为有效 UTF-8；结构化结果保留原始字节，文本便捷入口采用明确的有损 UTF-8 转换策略。

### R4 — 正确的 SSH framing 与 EOF 状态机

- PID 只解析首个换行符之前的字节。
- PID 行之后已经到达的字节必须作为 stdout 保留，不得丢弃。
- 本地 stdin sender 关闭后，bridge 应向远端发送 EOF，但继续接收 stdout、stderr、退出状态和远端 EOF。
- 正常 stdin EOF 不得导致 `Killed`。

### R5 — 单一 WSL 实现边界

- `wsl.rs` 是 `WslExecutor` 的唯一实现位置。
- factory 不应了解 Windows 与非 Windows 的不同 struct 形状；平台差异应封装在 WSL 模块内部。
- 保持 `ExecTarget::Wsl` 在非 Windows 可构造，并在执行时返回明确的 unsupported-platform 错误。

### R6 — TDD 与全异步迁移

- 每项行为修改先加入可复现的失败测试，再实现最小修复。
- 不依赖真实 WSL 或 SSH 服务器完成核心回归测试；优先使用 LocalExecutor、内存 async reader 和可控 fake executor。
- `exec_on` 及其调用链全部异步化；迁移现有 async 与同步调用层，包括 `GhCli`、PR provider、WSL 主题辅助函数及相关 Tauri commands。
- 删除通用的 `Handle::block_on` 同步包装器，不保留 `exec_on_blocking` 或其他要求调用方自行保证 runtime 上下文的兼容入口。

### R7 — 调用方适配统一的 stdin 流式接口

- `GitTransport::run_git_with_stdin` 必须通过 `create_executor` / `CommandExecutor::spawn` 使用现有 `ExecChild.stdin`，由调用方完成写入和关闭 EOF。
- Local、WSL、SSH 三个分支复用同一执行与输出收集路径；删除 WSL/SSH 的 Base64 shell stdin pipeline 及重复的进程管理逻辑。
- 可提取与业务无关的 `collect_child_output` 辅助函数，负责并发收集 stdout/stderr 和等待退出；该函数不得包含 Git 语义或负责生成输入。
- Git 调用层继续负责环境变量、工作目录、参数构造以及将结构化输出映射为 `GitExecError`。

### R8 — 保持既有 timeout 策略，不引入全局默认值

- 本次不为 executor 增加全局默认 timeout、取消 token 或自动 kill 策略。
- 全异步迁移不得删除或弱化 Local Git 当前已有的 30 秒 timeout 行为。
- WSL、Remote Git 以及其他命令是否采用 timeout 属于后续独立的产品与生命周期设计，不在本次机械可靠性修复中推断统一时限。
- 本次新增的收集 API 应保持未来可扩展性，但不得预先加入未使用的 options 抽象。

### R9 — `gh` 能力检测与执行目标一致

- `GhCli::is_installed` 与 `GhCli::is_authenticated` 改为基于实例 `ExecTarget` 的异步检测，不再固定调用宿主机 `std::process::Command`。
- Local 项目检查宿主机，WSL 项目检查指定 distro，Remote 项目检查对应远端主机；检测环境必须与后续 PR 命令执行环境一致。
- 迁移过程不得在 mutex guard 生命周期内执行远程 await；缓存读取与更新使用短锁作用域。
- 本次不新增额外的 gh 检测缓存策略，避免把性能策略混入执行模型修复。

### R10 — 清除同一执行域内的 WSL 同步直调

- AI Commit 的 WSL 分支不得继续在 async Tauri command 中直接使用同步 `std::process::Command` 调用 `wsl.exe`。
- 该分支迁移到 `ExecTarget::Wsl` 与统一的异步 executor/child 收集路径。
- 本次只替换执行通道，不修改 AI Commit prompt、环境变量、shell 命令构造或产品行为。
- 完成后，本任务覆盖的命令执行域内不得遗留可由统一 executor 表达的 async-runtime 阻塞子进程调用。

## Acceptance Criteria

- [ ] AC1：在 `#[tokio::test]` 内调用 canonical 命令收集 API 不 panic，并正确返回本地命令 stdout。（R1）
- [ ] AC2：同时产生超过管道/通道缓冲容量的 stdout 与 stderr 的命令能在测试 timeout 内结束。（R2）
- [ ] AC3：等待 stdin EOF 的命令在无输入收集模式下能在测试 timeout 内结束。（R2）
- [ ] AC4：结构化收集 API 在命令成功启动并取得退出状态后，对零和非零退出都返回 `ExecOutput`，其中独立保留 stdout、stderr 原始字节和退出码；便捷 `exec_on` 对非零退出统一返回包含准确退出码、stdout、stderr 的命令失败错误，且不显示为 SSH 传输错误。（R3）
- [ ] AC5：模拟 `PID\n首段输出` 合并数据帧时，PID 正确解析且首段输出完整保留。（R4）
- [ ] AC6：关闭 SSH stdin 后，bridge 继续转发后续 stdout/stderr 和 ExitStatus，正常完成不返回 `Killed`。（R4）
- [ ] AC7：非 Windows 构造并执行 `ExecTarget::Wsl` 返回 `ExecError::Wsl`；代码中仅保留一份非 Windows stub。（R5）
- [ ] AC8：仓库中不再存在 `Handle::block_on` 命令执行包装器；`exec_on`、`GhCli`、PR provider、WSL 主题辅助函数及相关 Tauri command 调用链均使用 async/await。（R1、R6）
- [ ] AC9：`GitTransport::run_git_with_stdin` 的 Local、WSL、SSH 路径均通过统一 `CommandExecutor::spawn` 写入并关闭真实 stdin，复用通用 child 输出收集逻辑，且不再使用 Base64 shell stdin pipeline。（R7）
- [ ] AC10：带 stdin 的 fake/local executor 测试验证完整输入、EOF、并发输出收集和非零退出映射。（R2、R3、R7）
- [ ] AC11：Local Git 已有的 30 秒 timeout 在迁移后仍由测试或代码路径验证保留；executor 不引入新的全局默认 timeout。（R8）
- [ ] AC12：`gh` 安装与认证检测通过对应项目的 `ExecTarget` 执行，并有 fake target/调用路径测试或等价验证证明不会固定探测宿主机。（R9）
- [ ] AC13：异步迁移后，`GhCli` owner/repo 缓存和 PR cache 不在持有同步 mutex guard 时 await。（R6、R9）
- [ ] AC14：AI Commit 的 WSL 分支通过 `ExecTarget::Wsl` 异步执行，不再在 async Tauri command 中直接等待同步 `wsl.exe` 子进程；原命令构造与结果处理行为保持一致。（R10）
- [ ] AC15：`cargo test --manifest-path src-tauri/Cargo.toml` 通过。（R6）
- [ ] AC16：`cargo check --manifest-path src-tauri/Cargo.toml` 通过；Windows 条件代码通过可用的交叉检查或静态 cfg 审查。（R5、R6）

## Child Task Map

- `07-15-async-executor-contract`：异步结构化收集、stdio 生命周期、错误语义、WSL 实现收敛。
- `07-15-ssh-executor-state-machine`：SSH PID framing、stdin half-close 与退出状态。
- `07-15-unify-git-stdin-execution`：Git 调用方适配真实 stdin、删除 Base64 pipeline、保留 Local timeout。
- `07-15-migrate-ai-commit-wsl`：AI Commit WSL 同步直调迁移。
- `07-15-async-gh-pr-chain`：GhCli、PrProvider、cache 和 PR Tauri chain 全异步化。
- `07-15-migrate-executor-callers`：主题、终端、Git remote/file helper 及剩余调用方迁移。

父任务负责跨子任务契约、最终全仓审计和 AC1–AC16 集成验收，不作为大段实现目标。

## Out of Scope

- 重写 SSH 认证实现或终端 PTY 架构。
- 改变 shell quoting、Git 命令拼装或凭据传输策略，除非修复 executor 后测试证明其直接阻塞本任务。
- 为测试搭建真实 SSH/WSL 服务。
- 修改前端功能或 UI。
