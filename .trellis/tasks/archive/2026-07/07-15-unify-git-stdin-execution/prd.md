# 统一 Git stdin 执行路径

## Goal

将 `GitTransport::run_git_with_stdin` 的三个分支（Local、WSL、SSH）迁移到统一的 `CommandExecutor::spawn` + `ExecChild.stdin` 执行路径，删除 WSL/SSH 的 Base64 shell stdin pipeline 及重复的进程管理逻辑。

## Requirements

- `run_git_with_stdin` 通过 `create_executor(target).spawn(cmd, args)` 启动命令，由调用方完成 stdin 写入和关闭 EOF。
- Local、WSL、SSH 三个分支复用同一执行路径和 `collect_child_output`。
- 删除 WSL/SSH 的 Base64 shell stdin pipeline 及 `base64_encode` 辅助函数（若无其他使用者）。
- 保留 Local Git 已有的 30 秒和 180 秒（网络操作）timeout 策略。
- Git 层继续负责环境变量、工作目录、参数构造、timeout 管理以及将结构化输出映射为 `GitExecError`。
- 不改变 shell quoting、凭据传输策略或 Git 命令构造的产品行为。

## Acceptance Criteria

- [ ] `run_git_with_stdin` 的 Local 分支通过 `tokio::process::Command` + `ExecChild` 写入 stdin，行为与当前一致。
- [ ] `run_git_with_stdin` 的 WSL/SSH 分支通过 `CommandExecutor::spawn` 写入 stdin，不再使用 Base64 shell pipeline。
- [ ] 三种分支均复用 `collect_child_output` 进行并发输出收集。
- [ ] 非零退出映射为 `GitExecError`，保留 stdout、stderr 和分类。
- [ ] Local Git 30 秒 timeout 在迁移后仍保留（通过测试验证）。
- [ ] 无 Base64 shell pipeline 残留。
- [ ] `cargo test executor` 全部通过；`cargo fmt --check` 通过。
- [ ] 无新 dead_code 警告或未使用的 `base64_encode`。

## Dependency

依赖子任务 1（async collection）和子任务 2（SSH bridge half-close）。

## Out of Scope

- AI Commit WSL 分支迁移（子任务 4）。
- timeout/cancellation 抽象或全局默认值增加。
- GH CLI 或 PR 操作。
