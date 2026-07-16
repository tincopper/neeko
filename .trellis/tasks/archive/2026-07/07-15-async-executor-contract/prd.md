# 异步执行器收集契约

## Goal

建立统一、纯异步且结构化的命令收集契约，消除 nested Tokio runtime、stdio 死锁、stdin EOF 挂起、错误分类混乱和 WSL 实现分叉，为后续调用方迁移提供稳定基础。

## Requirements

- 提供 `ExecOutput { stdout: Vec<u8>, stderr: Vec<u8>, exit_code: i32 }`，并标注必须使用结果。
- `collect_output` 对零和非零退出均返回 `ExecOutput`；spawn/I/O/wait 等基础设施失败才返回 `ExecError`。
- `exec_on` 为 async 便捷入口：零退出返回 stdout 文本，非零退出返回包含 code/stdout/stderr 的结构化 `CommandFailed`。
- 无输入收集必须关闭 stdin；stdout/stderr 必须并发读取。
- 保留 `CommandExecutor::spawn` 与 `ExecChild` 底层接口，不引入 caller-specific trait 方法。
- 删除 executor 层的 `Handle::block_on`/`exec_sync` 逻辑，不保留 blocking adapter。
- `wsl.rs` 成为 WSL executor 唯一实现位置；factory 使用平台中立构造器。
- 不增加全局 timeout/cancellation/options 抽象。
- 严格 TDD：每项行为先红灯测试，再实现。

## Acceptance Criteria

- [ ] `#[tokio::test]` 内调用 async collection 不 panic。
- [ ] 大量并发 stdout/stderr 在测试 timeout 内完整收集。
- [ ] 等待 stdin EOF 的命令在无输入模式下正常完成。
- [ ] raw non-UTF-8 stdout/stderr 仍保存在 `ExecOutput`。
- [ ] 非零本地退出由 collection 返回 output，由 `exec_on` 转为准确的 `CommandFailed`。
- [ ] 非 Windows `ExecTarget::Wsl` 可构造且执行返回 `ExecError::Wsl`。
- [ ] 只有 `wsl.rs` 包含非 Windows WSL stub；factory 无 cfg struct-shape 分支。
- [ ] executor collection 路径不存在 `Handle::block_on`。
- [ ] 定向测试、cargo fmt、clippy/check 通过。

## Dependency

无。此任务是其他五个子任务的基础，必须最先完成和评审。

## Out of Scope

- SSH PID/EOF 状态机修复。
- Git、PR、主题或 Tauri 调用方迁移。
- timeout/cancellation 产品策略。
