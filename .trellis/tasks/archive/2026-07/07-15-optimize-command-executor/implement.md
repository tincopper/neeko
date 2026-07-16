# Implementation Plan — 优化统一命令执行器

## Execution strategy

本父任务只负责规划、子任务依赖和最终集成验收。实现按子任务执行，遵守 TDD：每个行为先添加失败测试并确认红灯，再做最小实现、重构和子任务检查。

## Ordered checklist

### Gate 0 — Protect current worktree

- [ ] 记录当前 dirty paths；不得覆盖用户现有未提交修改。
- [ ] 为每个子任务确认其计划文件与实际 diff 只覆盖本子任务。
- [ ] 子任务开始前加载对应 PRD → design → implement → manifests。

### Child 1 — `07-15-async-executor-contract`

- [ ] 测试：async runtime 中调用收集 API 不 panic。
- [ ] 测试：大量 stdout/stderr 同时产生时在 timeout 内完成。
- [ ] 测试：等待 stdin EOF 的命令正常完成。
- [ ] 测试：结构化输出保留 stdout/stderr 原始字节和非零退出码。
- [ ] 测试：便捷入口将非零退出映射为结构化 `CommandFailed`。
- [ ] 测试：非 Windows WSL target 可构造并返回 WSL unsupported 错误。
- [ ] 实现 `ExecOutput`、async collection 和 async `exec_on`。
- [ ] 并发读取两个输出流；无输入调用主动关闭 stdin。
- [ ] 统一 child wait/exit semantics。
- [ ] 将 WSL cfg 实现收敛到 `wsl.rs`，factory 只调用稳定构造器。
- [ ] 删除 executor 层 `Handle::block_on` 逻辑；如调用方尚未迁移导致编译失败，在同一子任务只提供 async API，不恢复阻塞 shim。
- [ ] 运行定向 executor 测试、fmt、clippy/check。

**Rollback point:** 若新 collection contract 无法覆盖现有调用方，回滚 child 1 并调整契约；禁止临时恢复 nested `block_on`。

### Child 2 — `07-15-ssh-executor-state-machine`

- [ ] 测试：`PID\n首段输出` 同帧时 PID 和后缀均正确。
- [ ] 测试：PID 跨帧时正确累积。
- [ ] 测试：stdin sender 关闭后继续处理 stdout/stderr/ExitStatus/Eof。
- [ ] 测试：正常 EOF 不返回 `Killed`。
- [ ] 提取可测试的 PID framing/state transition 逻辑。
- [ ] 将 local stdin close 改为一次 SSH EOF half-close，不退出 bridge。
- [ ] 保证退出状态和输出不丢失、不乱序。
- [ ] 运行定向 SSH 逻辑测试和质量检查；不要求真实 SSH 服务。

**Rollback point:** 若 russh channel 生命周期限制阻碍实现，保留测试与证据，回到设计阶段调整状态机，不以忽略输出代替修复。

### Child 3 — `07-15-unify-git-stdin-execution`

- [ ] 测试：Local/fake child 收到字节与输入完全一致并收到 EOF。
- [ ] 测试：带输入命令的 stdout/stderr 并发收集。
- [ ] 测试：非零退出映射为 `GitExecError` 并保留双流。
- [ ] 测试或代码契约验证：Local Git 30 秒 timeout 保持。
- [ ] `run_git_with_stdin` 通过 `create_executor`/`spawn` 写入 stdin。
- [ ] 三种 target 复用 child output collector。
- [ ] 删除 WSL/Remote Base64 stdin shell pipeline。
- [ ] 保留 Git 层的 env、workdir、argument、error classification 职责。
- [ ] 运行 GitTransport 定向测试及完整 Rust 测试。

**Dependency gate:** children 1 and 2 completed.

### Child 4 — `07-15-migrate-ai-commit-wsl`

- [ ] 测试/提取验证：原 WSL AI Commit 命令构造保持不变。
- [ ] 测试：成功、非零退出、stdout/stderr 映射保持一致。
- [ ] 将 username lookup 和 agent invocation 迁移到 `ExecTarget::Wsl` async 路径。
- [ ] 删除 covered async command 内同步 `wsl.exe` process wait。
- [ ] 不修改 prompt、environment loading 或日志契约。
- [ ] 运行定向测试和 git command 编译检查。

**Dependency gate:** child 1 completed.

### Child 5 — `07-15-async-gh-pr-chain`

- [ ] 测试：`GhCli::is_installed`/`is_authenticated` 使用实例 target。
- [ ] 测试：owner/repo cache hit 不执行命令；miss 不持锁 await 并正确更新。
- [ ] 测试：PR cache lookup/await/store 不持锁 await。
- [ ] 将 GhCli run/json/api/repo discovery/capability methods async 化。
- [ ] 使用 `#[async_trait]` 迁移 `PrProvider` 与所有实现，保持 trait object。
- [ ] 迁移 PR dispatch/cache adapter 和 Tauri commands。
- [ ] Tauri command 在 await 前克隆 project data 并释放 manager lock。
- [ ] 删除仅为调用同步 PR 代码存在的 `spawn_blocking`。
- [ ] 保持前端 IPC command name、参数和结果 shape 不变。
- [ ] 运行 PR/Gh 定向测试、完整 Rust 测试和编译检查。

**Dependency gate:** child 1 completed.

### Child 6 — `07-15-migrate-executor-callers`

- [ ] 将 common Git remote/transport 和 git file helpers 改为直接 await。
- [ ] 删除 executor 调用周围无必要的 `spawn_blocking`。
- [ ] 将 WSL theme helpers、ThemeStrategy、theme commands、terminal caller async 化。
- [ ] 保持纯 Local theme filesystem 操作同步。
- [ ] 确认主题同步失败仍按现有策略记录/传播，不改变产品行为。
- [ ] 与 child 5 协调 `git/commands.rs` 重叠区域，避免覆盖其修改。
- [ ] 所有调用点迁移后删除 obsolete executor sync module/import。
- [ ] 检索不存在未 await 的新 `exec_on` 调用。
- [ ] 运行 theme/terminal/Git 定向测试与完整质量检查。

**Dependency gate:** child 1 completed；优先在 child 5 之后落地。

### Parent integration gate

- [ ] 所有六个 child 完成并归档/标记完成。
- [ ] 检索并审计：`Handle::block_on`、`executor::sync`、`exec_sync`。
- [ ] 检索所有 `exec_on` 调用，确认 async/await。
- [ ] 检索 covered async domain 内直接 `std::process::Command` / `wsl.exe` 等待。
- [ ] 检索 `run_git_with_stdin` 中 Base64 pipeline。
- [ ] 审计 mutex guards 不跨 await。
- [ ] 确认没有新增全局 executor timeout/cancellation 默认策略。
- [ ] 确认 Local Git 30 秒 timeout 未被删除或弱化。
- [ ] 运行全量验证并记录结果。

## Validation commands

```bash
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets
cargo test --manifest-path src-tauri/Cargo.toml
cargo check --manifest-path src-tauri/Cargo.toml
```

仓库级调用点审计：

```bash
rg -n "Handle::block_on|exec_sync|executor::sync" src-tauri/src
rg -n "exec_on\(" src-tauri/src
rg -n "std::process::Command|wsl\.exe" src-tauri/src/git src-tauri/src/theme src-tauri/src/terminal
rg -n "base64.*git|base64 -d \| git" src-tauri/src/common/git/transport.rs
```

Windows 验证：优先运行已有 Windows CI/cross-target check；本机缺少 Windows target/toolchain 时，记录静态 cfg 审查结果，不虚报已完成跨平台编译。

## Review gates

1. Child 1 contract review before downstream implementation.
2. Child 2 state-machine review before Remote Git stdin migration。
3. Child 5 lock-lifetime review before PR Tauri migration完成。
4. Parent final review must cover behavior, cleanup, concurrency, and platform cfg。

## Deferred follow-up

单独创建 timeout/cancellation hardening task，设计 opt-in options、process group cleanup、SSH kill、caller-specific duration 和 UI mapping；不阻塞本任务。
