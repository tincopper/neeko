# 命令执行点全仓审计（2026-10-07）

> 目的：为「统一命令执行标准」给出**穷尽、可复核**的现状清单与分类判据。
> 所有锚点为 `file:line`（审计时刻的 `main`）。复跑命令见文末。

## 0. 标准与判据

**标准契约（唯一）**：调用方只描述「跑什么」（命令 + 参数 + 工作目录 + 环境变量 + 是否树杀），
**执行方式由 `ExecTarget` 对应的 executor 决定**。调用方不得知道 shell、不得拼 `cd`、不得拼
`VAR=value` 前缀、不得做 shell 引号转义。

合法形态只有两种：

| 形态 | 契约 | 适用 |
| --- | --- | --- |
| **argv** | `exec::collect/spawn_with(target, cmd, args, cwd)` 或 `SpawnOptions::new(cmd, args).with_current_dir(..).with_env(..)` | 命令与参数可枚举（含 git、mkdir、find、rm、mv、printenv…） |
| **script** | 统一层提供的「脚本入口」（内部按 target 选 shell） | 确有管道 / 重定向 / heredoc / 用户给定的命令串（preLaunchTask、agent 命令串、`ls\|grep\|sed`、`base64 -d >`） |

**违规形态**（本次要消灭的）：

- V1：把 shell 当命令传（`cmd == "sh"/"bash"/"cmd"/"powershell"`）；
- V2：自造 shell 选择（`remote_shell_name` 式的执行环境分叉；脚本内容里的 `safe_path` /
  `quote_shell_arg` 路径转义不算违规 —— 那是脚本内容，不是 shell 选择）；
- V3：绕过 `core::exec` / `common::executor` 直接用 `std::process::Command`。

**豁免**（红线 1/10 已列，勿动）：

- `platform/host_path/*`（PATH 引导，早于 exec_env 初始化）；
- `platform/process_spawn/*`（OS 进程原语，位于 executor 之下）；
- `platform/reveal/*`、`platform/process_memory/*`（fire-and-forget 平台原语）；
- `terminal/*` 的 PTY 通道（portable-pty，非命令执行；shell 选择已由 `platform/shell_launch` 集中）；
- 测试内夹具（`#[cfg(test)]`）。

## 1. 统一层现状（模型已经是对的）

- `common/executor/traits.rs::CommandExecutor::spawn_with`：统一接口。
- `LocalExecutor::spawn_with`：直接 spawn，`current_dir` + `env` 直传 `std::process::Command`。
- `WslExecutor::spawn_with`（`common/executor/wsl.rs:68`）：自己拼 `export …; cd …; exec <cmd>` 再用 `wsl.exe -- bash -lc` 包。
- `SshExecutor::spawn_with`（`common/executor/ssh.rs:157`）：同一 login-script 模式，走 SSH channel `bash -lc`。

**结论**：WSL/SSH 的「怎么跑」已经统一实现；缺的是 **Local 的 script 形态**（目前无处可选 `cmd /C` vs `sh -c`），
以及**调用方普遍绕过**这套模型。

## 2. 违规点清单（生产代码）

### 2.1 V1+V2：git 传输层（本次 Windows CI 红的直接原因）

| 锚点 | 现状 | 目标 |
| --- | --- | --- |
| `common/git/transport/local.rs:36-56` | `cd '…' && VAR=v exec git …` + 硬编码 `sh -c` | argv 形态（`git` + argv + `current_dir` + `env`） |
| `common/git/transport/local.rs:63-110`（stdin 变体） | 同上 | 同上（+ `current_dir`） |
| `common/git/transport/wsl.rs:16-35` | 手拼 `cd + env + git`，再交 executor 包一层 `bash -lc` | 同上 |
| `common/git/transport/ssh.rs:17-38` | 同上 | 同上 |
| `common/git/transport/mod.rs:276`（`shell_quote`） | POSIX 引号（业务层） | 删（executor 负责引号） |
| `common/git/transport/mod.rs:288-341`（`run_shell_streaming`） | spawn 段收 `program + "-c" + shell_cmd` | spawn 段收 `SpawnOptions`（编排段保留） |
| `common/git/transport/{wsl,ssh}.rs` 的 `--` 插入 | 产出 `git -- status …`，实测 git 直接拒绝（`unknown option: --`） | 删（正确性修复） |
| `common/git/transport/ssh.rs:41-78` | 已走 `executor.spawn("git", …)`，但丢 `current_dir` / `env` | 补全 |

**行为冻结**：git 的 argv 语义、`git_command_timeout` 策略、`classify_stderr` / `GitExecError`、
`with_default_env("git")` 注入一律逐字不变（本次只换「怎么跑」）。

### 2.2 V1+V2：业务域自拼 shell

| 锚点 | 现状 | 目标形态 |
| --- | --- | --- |
| `dap/process.rs:59` `run_pre_launch_task` | `exec::collect(target, "bash", &["-lc", task], None)` —— Local/Windows 必挂 | **script**（用户命令串） |
| `dap/launch_support.rs:94-103` `build_shell_argv` | 已有 `cmd /C` vs `sh -c` 分支（红线 2 参照实现） | 上收统一层，本处改为调用统一入口 |
| `agent/commands_commit.rs:133` | `run(&target, "bash", &["-c", &actual_cmd])`（`actual_cmd` 含 `cd` 前缀，见 `ai_svc::build_agent_commit_cmd`） | **script** + `current_dir` |
| `theme/pi.rs:124` | WSL：`bash -c "mkdir -p …"` | argv（`mkdir`） |
| `theme/pi.rs:155,193,207,230,256`；`theme/opencode.rs:155` | WSL：`bash -c "echo … \| base64 -d > …"` / `mkdir -p` | 写文件走 script 或 stdin；mkdir 走 argv |
| `connection/commands.rs:73` | Remote：`sh -c "echo $HOME"` | argv（`printenv HOME`） |
| `connection/services.rs:40` | WSL：`bash -c "ls -1p … \| grep … \| sed …"` | **script**（管道） |
| `connection/services.rs:61` | WSL：`bash -c "echo $HOME"` | argv（`printenv HOME`） |
| `common/file/services/file_write.rs:133-138,173-177,196-202` | Remote/WSL：`mkdir -p`、`touch`、`cat > f <<EOF`、`echo … \| base64 -d > f` | mkdir/touch → argv；写内容 → stdin 或 script |
| `common/file/services/tree_read.rs:85-89` | Remote/WSL：`find …` | argv（`find`） |
| `common/file/services/path_ops.rs:73,150,158,258,269` | Remote/WSL：`mkdir -p` / `test -e … && echo yes \|\| echo no` / `rm -rf` / `mv` | argv（`mkdir`/`test`/`rm`/`mv`） |
| `common/file/services/shell_cmd.rs`（整文件） | 业务层自造 `remote_shell_name` + 命令字符串 | 删（上收） |
| `core/exec.rs:88-93` `command_exists` 的 WSL/SSH 分支 | `run(target, "sh", &["-c", "command -v …"])` | script（`command -v` 是 builtin） |

### 2.3 V3：绕过 facade 的直接 spawn

| 锚点 | 现状 | 判定 |
| --- | --- | --- |
| `common/utils/fonts.rs:172-187` | Windows：直接 `std::process::Command::new("powershell")`（含内联 `CREATE_NO_WINDOW`） | **违规**（红线 1 + 红线 10：平台代码内联在通用文件） |
| `common/utils/fonts.rs:204-215` | Linux：直接 `Command::new("fc-list")` | 同上 |
| `common/utils/command/local.rs:23` | `windows_command` helper | 豁免（红线 1 明列） |
| `platform/reveal/*`、`platform/process_memory/macos.rs:4`、`platform/host_path/unix.rs:13`、`platform/process_spawn/windows.rs:18` | 平台原语 | 豁免 |
| `project/clone.rs:551,630` | `#[cfg(test)]` 夹具 | 豁免 |
| `common/git/{perf.rs,status_worker/worker.rs:620}` | 测试/基准 | 豁免 |

## 3. 已达标（保持）

- `lsp/process.rs`（`core::exec::spawn_with` / `collect_blocking`）。
- `dap/process.rs::spawn_adapter`（`exec::spawn_with`）。
- `agent/manager.rs`（红线 1 正例）。
- `common/git/transport/mod.rs` 的编排段：`hooks` / `cancel` / `child_registry` / `finish_git_output`。
- `terminal/*` PTY 通道与 `platform/shell_launch`。

## 4. 复跑命令

```bash
# V1：把 shell 当命令传（生产代码）—— 期望仅 platform/ 与统一层
rg -n '"sh"|"bash"|"cmd"|"powershell|"pwsh"' src-tauri/src --type rust -g '!**/*test*'
# V2：自造 shell 选择 —— 期望零命中（safe_path 仅剩脚本内容转义，不算违规）
rg -n "remote_shell_name" src-tauri/src --type rust -g '!**/*test*'
# V3：绕过统一接口 —— 期望仅 platform/ 与执行层/测试
rg -n "process::Command::new|Command::new\(" src-tauri/src --type rust -g '!**/*test*'
```

> 权威判据是护栏 `check_command_execution`（`pnpm guards run --only check_command_execution`）：
> 全仓 338 个生产文件 0 违规（已排除 `platform/` / `common/executor/` / `terminal/` /
> `common/utils/command/` / `core/exec.rs`）。
