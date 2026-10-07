# 统一应用内命令执行到标准 executor 路径

## Goal

把「执行命令」收敛为**唯一模型**：调用方只声明「跑什么」（命令 + 参数 + 工作目录 + 环境变量 +
是否树杀），由 `ExecTarget` 对应的 executor 决定「怎么跑」（是否经 shell、哪个 shell、如何
`cd`、env 如何送达、如何树杀）。消灭业务层自拼 shell（`sh -c` / `bash -lc` / `cmd /C`）、
自拼 `cd`/env 前缀、以及绕过 facade 的直接 `std::process::Command`。

用户价值：Windows（以及未来任何环境扩展）不再需要在每个调用点各修一遍路径/shell 兼容；
`\\?\` 规范路径、WSL/SSH 登录 shell、进程树清理这三类问题只在一个地方解决。

## Background

Windows `backend-test` 4 条失败暴露了模型被绕过：

- `common::file::watcher::manager::lifecycle_tests`（2 条）把快照的身份渲染字段
  (`snapshot.worktree_path`) 与执行渲染 (`RepoRef::work_dir()`) 直接比较；两者仅在 Windows
  上因 `\\?\` 前缀不同形而不等 —— 断言写错，不是快照错。
- `git::services::status`（2 条）经 `common/git/transport/local.rs` 的
  `cd '\\?\C:\…' && exec git …`（硬编码 `sh -c`）执行，Git Bash 的 `cd` 不认 `\\?\`。

根因不是 git，而是**执行层重复**：executor（`WslExecutor`/`SshExecutor`）已经实现了
「`export …; cd …; exec <cmd>` + 登录 shell」，git 传输层又在上层手工拼了一遍，且硬编码
POSIX shell（红线 2 明令禁止）。同一形态散落在 10+ 处（见
`research/command-execution-audit.md`）。

## Requirements

### R1 统一模型（契约冻结）

- R1.1 调用方**只能**通过 `crate::core::exec`（`run` / `collect` / `spawn` / `spawn_with`）
  或 `common::executor`（`ExecTarget` + `create_executor` + `SpawnOptions`）起进程。
- R1.2 合法形态只有两种：**argv 形态**（`cmd` + `args` + `current_dir` + `env`）与
  **script 形态**（确有管道 / 重定向 / heredoc / 用户给定命令串时）。
- R1.3 script 形态的 shell 选择由统一层按环境决定（Local：Windows `cmd /C`、Unix `sh -c`；
  WSL / SSH：登录 `bash`）。调用方不得出现 shell 程序名或 shell 转义。

### R2 新增 script 入口

- R2.1 提供单一 script 入口（命名与落点在 `design.md` 敲定），签名至少覆盖
  `(target, script)`、可选 `current_dir`、可选 `env`、可选超时/取消（git 编排需要）。
- R2.2 Local 的 shell 选择实现落在 `platform/`（或复用红线 2 参照实现的既有 `#[cfg]` 单分支
  策略），业务层零 `#[cfg]`。

### R3 git 传输层迁移（行为冻结）

- R3.1 `common/git/transport/{local,wsl,ssh}.rs` 的自拼脚本删除，统一走 argv 形态；
  `run_shell_streaming` 的 spawn 段改为接收 `SpawnOptions`，编排段（hooks / cancel /
  `child_registry` / 超时 / `finish_git_output`）保留。
- R3.2 **git 业务逻辑逐字不变**：argv 组合、`git_command_timeout` 策略、`classify_stderr`
  与 `GitExecError`、`with_default_env("git")`（`GIT_OPTIONAL_LOCKS=0`）注入、
  `GIT_TERMINAL_PROMPT` 网络操作注入。仅「怎么跑」改变。
- R3.3 修掉两个既有缺陷：WSL/SSH 分支误插的 `--`（`git -- status` 被 git 拒绝）、
  `run_git_with_stdin` 的 WSL/SSH 分支丢 `work_dir`。
- R3.4 修掉 `lifecycle_tests.rs:439,626` 的断言（改比 `RepoRef::worktree_path()`，身份对身份）。

### R4 业务域迁移

- R4.1 `dap`（`process.rs::run_pre_launch_task`）、`theme`（`pi.rs` / `opencode.rs`）、
  `connection`（`commands.rs` / `services.rs`）、`agent/commands_commit.rs`、
  `common/file/services/*`（`file_write.rs` / `tree_read.rs` / `path_ops.rs` / 删除
  `shell_cmd.rs`）、`core/exec.rs::command_exists` 全部迁到 argv 或 script 形态。
- R4.2 `common/utils/fonts.rs` 的平台专属直接 spawn 收口：平台实现迁 `platform/<theme>/`，
  命令经统一接口执行（同时消红线 1 与红线 10 违规）。
- R4.3 迁移中若发现同一命令字符串被复制 ≥2 处，抽到 argv 常量或统一入口，不在各域重复。

### R5 护栏与文档

- R5.1 新增护栏：生产代码（排除测试与 `platform/` 豁免清单）出现 shell 程序名当命令、
  自拼 `cd … &&`、`remote_shell_name` 式自造选择、直接 `std::process::Command` 即违规。
- R5.2 `.trellis/spec/backend/git-domain.md:227-228` 的「transport 内部 `sh -c` 是合法特例」
  退役；`common/executor/env_defaults.rs` 模块注释的「WSL/SSH 渲染成 shell 前缀」措辞更新。
- R5.3 统一命令执行标准写入 spec（落点见 `design.md`）。

## Acceptance Criteria

- [ ] AC1 `pnpm test:rust` 全绿，**包括 Windows `backend-test`**（4 条 Windows-only 回归不再
      出现；`git status` / `read_unit_status` 用例在 Windows 通过）。*本机 mac 全绿；Windows 由 CI 复核。*
- [x] AC2 `git-domain.md` 指定的 git 行为不变：`transport/tests.rs`（streaming 聚合一致、stderr
      分类、空 work_dir 拒绝）、`check_git_optional_locks_single_source` 仍绿；新增 golden
      `git_argv_matches_pre_migration_shape_and_omits_stray_double_dash`。
- [x] AC3 审计复跑：新护栏 `check_command_execution` 在全仓 338 个生产文件 **0 违规**
      （`platform/` / `common/executor/` / `terminal/` / `common/utils/command/` / `core/exec.rs` 豁免）。
- [x] AC4 新护栏接入 `pnpm lint`（`--stage local`）与 CI（`--stage ci`），自身 9 条负例/正例测试。
- [x] AC5 `dap/process.rs::run_pre_launch_task` 走 `exec::collect_script`（Local `cmd /C`、WSL/SSH
      登录 shell）；`platform::shell_launch::shell_argv` + `collect_script` 有平台/脚本单测。
- [x] AC6 `pnpm lint`（eslint + tsc + fmt + clippy + 全部护栏）通过。

## Out of Scope

- **git 业务逻辑**：不新增/删除 git 子命令，不改超时、错误分类、只读语义注入、事件载荷。
- `terminal/*` PTY 通道（portable-pty，非命令执行；其 shell 选择已在 `platform/shell_launch`）。
- `platform/` 已列豁免（`host_path` / `process_spawn` / `reveal` / `process_memory`）。
- 前端。
- 不为「以后可能的执行环境」预留抽象（YAGNI）。

## Open Questions

- 任务结构：单任务分阶段，还是 parent + 按域 child？见 `implement.md` 结尾的判定。
