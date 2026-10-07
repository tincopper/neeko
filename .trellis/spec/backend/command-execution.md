# 统一命令执行标准

> 后端任何「起进程」的调用都必须遵守本契约。判据可机械复核（新护栏
> `tools/guards/checks/check_command_execution.py` 钉住）。基础红线：根 `AGENTS.md` 红线 1/2/10、
> `src-tauri/AGENTS.md`「审查红线」。

---

## 1. 职责边界：执行 vs 编排

| | 负责 | 唯一事实源 |
| --- | --- | --- |
| **执行** | 起进程：shell 选择、`cd`、env 送达、PATH、树杀、stdio 采集 | `common/executor`（`ExecTarget` + `create_executor` + `SpawnOptions`） |
| **编排** | 跑什么 / 跑多久 / 怎么收：argv 组合、超时策略、取消赛跑、流式交付、错误分类、子进程登记 | 各业务域（git 的 `common/git/transport` 是其中之一） |

**判据句（可机械复核）**：**换个执行环境就要重写一遍的代码 = 执行细节（必须上收）；只有该领域
才成立的代码 = 编排（留在该域）。**

## 2. 唯一调用契约

调用方**只能**产出两种请求，两者都不含：shell 程序名、`cd`、`VAR=value` 前缀、`'`/`"` 转义。

> **路径是字面量，不是 shell 模板**：argv 形态与 `shell_escape` / `safe_path` / `base64_write_script`
> 都会（单引号或直接传参）**阻止 `$VAR` 展开**。需要 `$HOME` 前缀时，必须先在目标环境解析
> （`core::exec::run(target, "printenv", &["HOME"])` / `theme::common::wsl_home`）再拼绝对路径；
> **禁止**把 `"$HOME/…"` 这类模板传给按字面量处理的入口（单引号会把它写进名为 `$HOME` 的目录）。

| 形态 | 契约 | 适用 |
| --- | --- | --- |
| **argv** | `core::exec::{run,collect,spawn,spawn_with}` 或 `SpawnOptions::new(cmd, args).with_current_dir(..).with_env(..)[.with_kill_tree()]` | 命令与参数可枚举（git、mkdir、find、rm、mv、printenv、test…） |
| **script** | `core::exec::{collect_script,run_script}`（`(target, script, dir, env)`） | 确有管道 / 重定向 / heredoc / 用户给定的命令串 |

`script` 形态的 shell 选择由**执行层**决定，facade 只是转发：

- 统一入口是 `CommandExecutor::spawn_script(ScriptOptions)`（**无默认实现**，缺实现编译不过）；
  facade `core::exec::{collect_script,spawn_script}` 仅是它的薄封装。
- **Local**：Windows `cmd /C`、Unix `sh -c` —— 唯一实现处
  `platform::shell_launch::shell_argv`，由 `LocalExecutor` 消费（与 PTY 任务命令同主题）；
- **WSL / SSH**：脚本**直接作为登录 shell 的执行体**（`bash -lc "export …; cd …; <script>"`），
  前缀由 `common::executor::login_script` 单点渲染；不再嵌套一层 `sh -c`。

`ExecTarget::Local` 的 **argv** 形态由 `LocalExecutor` 直接 `spawn`：`current_dir` 原生支持
Windows verbatim 路径（`\\?\…`），**不做** shell 解析。

## 3. 禁止形态

- **V1**：把 shell 当命令传 —— `cmd` 实参是 `"sh"` / `"bash"` / `"cmd"` / `"powershell"` / `"pwsh"`；
- **V2**：自造 shell 选择 —— 出现 `remote_shell_name` 式的执行环境分叉（shell 选择属于执行层）；
  script 形态内容里的路径转义（`shell_escape` / `safe_path`）不算违规 —— 那是脚本内容，
  不是 shell 选择；
- **V3**：绕过统一接口 —— 生产代码直接 `std::process::Command` / `tokio::process::Command`。

> **判据边界（静态可判定的射程，勿误读为全称）**：V1 只捕获「shell 名字面量**直接**作为
> `cmd` 实参」；`let shell = pick(); run(t, shell, …)` 这类经变量间接传入不在射程内（V2 的
> `remote_shell_name` 只覆盖已知的「自造选择」形态）。间接形态靠评审 + 本规范的「唯一入口」约定约束。

**豁免**（仅此类，且文件内必须注释说明原因）：`platform/host_path/*`（PATH 引导探测）、
`platform/process_spawn/*`（OS 进程原语，位于 executor 之下）、`platform/reveal/*`、
`platform/process_memory/*`（fire-and-forget 平台原语）、`terminal/*`（PTY 通道，非命令执行）、
测试夹具（`#[cfg(test)]`）。详见 `quality-guidelines.md`「平台差异集中化 · 边界」。

## 4. git 传输层的行为冻结

`common/git/transport` 迁移到 argv 形态时**只换「怎么跑」**，git 业务逻辑逐字不变：

- argv 组合：`-c k=v` 配置项在前、用户 args 在后（**不**插入 `--`；`git -- <cmd>` 被 git 拒绝）；
- `git_command_timeout` 策略（Local 有上界、WSL/SSH 长操作无墙钟）；
- `classify_stderr` / `GitExecError`；
- `with_default_env("git")`（`GIT_OPTIONAL_LOCKS=0`）与 `GIT_TERMINAL_PROMPT` 注入。

契约见 `git-domain.md` §9/§13；golden 用例 `transport/tests.rs::git_argv_matches_pre_migration_shape_and_omits_stray_double_dash`。

## 5. 测试要求

- `platform::shell_launch::shell_argv`：三端纯函数断言（Windows `cmd /C`、Unix `sh -c`）。
- `common::executor::login_script`：**WSL/SSH 登录脚本前缀的纯函数直测**（env / cd / exec 与
  script 两种体）—— 远程分支的核心在这里可脱离真实主机验证。
- `core::exec::collect_script` / `run_script` / `spawn_script`：Local 的脚本语义（退出码 / stderr /
  `current_dir` / `env`）跨平台断言；远端 spawn 本身由 `common/executor` 单测与 CI 矩阵兜底。
- `common::utils::command::local::base64_write_script`：脚本拼装 + 路径转义直测（WSL/SSH 写文件复用）。
- 迁移每个域时先写等价性测试，再改「怎么跑」；断言用 `tempdir()` 推导路径（红线 13）。
