# 设计：统一命令执行标准

> 配套：`prd.md`（需求/验收）、`research/command-execution-audit.md`（现状清单）、
> `implement.md`（执行计划）。

## 1. 边界：执行 vs 编排

| | 负责 | 唯一事实源 | 本次动作 |
| --- | --- | --- | --- |
| **执行** | 起进程：shell 选择、`cd`、env 送达、PATH、树杀、stdin/stdout 采集 | `common/executor`（`ExecTarget` + `create_executor` + `SpawnOptions`） | 只**补一个 Local 的 script 形态** |
| **编排** | 跑什么/跑多久/怎么收：argv 组合、超时策略、取消赛跑、流式交付、错误分类、子进程登记 | 各业务域（git 的 `transport` 是其中之一） | 只把「执行细节」删掉 |

判据（可机械复核）：**换个执行环境就要重写一遍的代码 = 执行细节（上收）；只有该领域才成立的
代码 = 编排（留下）。**

## 2. 统一契约

调用方只能产出两种请求：

```
argv   形态：SpawnOptions::new(cmd, args).with_current_dir(dir).with_env(env)[.with_kill_tree()]
script 形态：exec::collect_script(target, script, dir, env)   // 新增
```

两者都不含：shell 程序名、`cd`、`VAR=value` 前缀、`'`/`"` 转义。

### 2.1 禁止形态（护栏判据，见 R5.1）

- V1：`cmd` 实参是 `"sh"` / `"bash"` / `"cmd"` / `"powershell"` / `"pwsh"`；
- V2：脚本串里出现 `cd ` + `&&` 拼接，或 `remote_shell_name` / `safe_path` / `quote_shell_arg`
  式自造选择与转义；
- V3：生产代码直接 `std::process::Command` / `tokio::process::Command`（豁免清单除外）。

## 3. API 设计

### 3.1 新增：script 入口（`core::exec`）

```rust
// core/exec.rs
/// 在目标环境用**该环境的 shell** 执行一段脚本。
/// Local：Windows `cmd /C`、Unix `sh -c`；WSL / SSH：登录 shell（executor 负责）。
pub async fn collect_script(
    target: &ExecTarget,
    script: &str,
    current_dir: Option<&str>,
    env: &[(&str, &str)],
) -> Result<ExecOutput, ExecError>;

/// 便捷包装：成功返回 trim 后的 stdout（等价于现有 `run`）。
pub async fn run_script(target: &ExecTarget, script: &str) -> Result<String, ExecError>;
```

实现（`executor` 完全不改）：

```rust
match target {
    ExecTarget::Local => {
        let (program, argv) = platform::shell_launch::shell_argv(script);
        let child = create_executor(target)
            .spawn_with(SpawnOptions::new(program, &argv)
                .with_current_dir_if(current_dir)
                .with_env(env))
            .await?;
        collect_child_output(child).await
    }
    ExecTarget::Wsl { .. } | ExecTarget::Remote { .. } => {
        // executor 的 login script 已负责 `export env; cd dir; exec <cmd>`
        let child = create_executor(target)
            .spawn_with(SpawnOptions::new("sh", &["-c", script])
                .with_current_dir_if(current_dir)
                .with_env(env))
            .await?;
        collect_child_output(child).await
    }
}
```

- Local 分支的 `sh -c` 是**执行层**的合法用法（这正是 red line 2 要求的平台选择）；业务层永远
  不写这一行。
- WSL/SSH 分支传 `sh -c script` 会让 login script 产出
  `export …; cd …; exec 'sh' '-c' '<script>'`：登录环境生效、脚本语义保持；代价是一次额外
  `sh` 进程（可接受，换来 executor 零改动）。

### 3.2 新增：平台 shell 选择（`platform`）

把 `dap/launch_support.rs:88-103` 的 `build_shell_argv` 上收到
`platform/shell_launch/{windows,unix}.rs`（与现有 `build_task_command` 同主题），签名逐字保留：

```rust
pub(crate) const fn shell_argv(script: &str) -> (&'static str, [&str; 2]) {
    #[cfg(windows)]  { ("cmd", ["/C", script]) }
    #[cfg(not(windows))] { ("sh", ["-c", script]) }
}
```

`dap` 改为调用 `exec::collect_script`（连带消掉本地 `build_shell_argv`）。`platform/shell_launch`
的模块文档补一行：**命令执行（非 PTY）的 shell 选择也在这里**。

### 3.3 不变：argv 形态

`exec::collect/spawn_with` 与 `SpawnOptions` 原样可用；本次只是让原本自拼 shell 的调用方改用它。

## 4. 数据流

| target | argv 形态 | script 形态 |
| --- | --- | --- |
| Local | `LocalExecutor` 直接 spawn（`current_dir` 原生，吃 `\\?\`） | `platform::shell_launch::shell_argv` → `cmd /C` \| `sh -c` |
| WSL | `WslExecutor` 拼 `export…; cd…; exec <cmd>`，`wsl.exe -- bash -lc` | 同 argv（`cmd = sh -c script`），由 login script 承载 env/cd |
| SSH | `SshExecutor` 同构（channel `bash -lc`，远端 pid 供树杀） | 同 WSL |

关键性质：**调用方对三列无感知**；`current_dir` / `env` 只需声明一次。

## 5. git 传输层迁移设计

### 5.1 前后对照

```rust
// before（local.rs）：业务层拼 shell，三层信息混在字符串里
let shell_cmd = format!("cd {} && {}exec git {}", shell_quote(work_dir), env_prefix, quoted_args);
run_shell_streaming(target, "sh", &shell_cmd, &label, timeout, hooks).await

// after（三端合一，在 mod.rs 的 impl GitTransport for ExecTarget 内）
let argv: Vec<String> = opts.config_args().into_iter().chain(args.iter().map(ToString::to_string)).collect();
let arg_refs: Vec<&str> = argv.iter().map(String::as_str).collect();
let env = with_default_env("git", opts.env);           // + GIT_TERMINAL_PROMPT（网络操作）
let spawn = SpawnOptions::new("git", &arg_refs)
    .with_current_dir(work_dir)
    .with_env(&env)
    .with_kill_tree();
run_spawn_streaming(self, spawn, &format!("git {}", argv.join(" ")), timeout, hooks).await
```

- `run_shell_streaming(program, shell_cmd, …)` → `run_spawn_streaming(SpawnOptions, …)`：
  **只换 spawn 段**；`hooks` / `cancel` / `child_registry` 登记 / 超时 / 输出采集与错误映射
  原样保留（`finish_git_output` 不变）。
- `ExecTarget::{Local,Wsl}` 的 `timeout` 策略保持现状（Local=`git_command_timeout(args)`、
  WSL/SSH=`None`）——按 PRD R3.2，git 业务逻辑不动；实现上保留一个
  `fn timeout_for(target, args)` 的分支即可，不引入新语义。
- `transport/{local,wsl,ssh}.rs` 的 `run_git_*` 全部删除；只留 `is_git_repo_*` 与测试。

### 5.2 缺陷修复（同批）

| 缺陷 | 证据 | 修复 |
| --- | --- | --- |
| WSL/SSH 误插 `--` → `git -- status` | `git -c k=v -- status` 退出 129（`unknown option: --`）；`git -c k=v status` 退出 0 | argv 不再插 `--` |
| `run_git_with_stdin` 丢 `work_dir`（`ssh.rs:41`） | 持 `work_dir` 参数未用 | argv 形态带上 `current_dir`（WSL/SSH 也与 Local 同语义） |
| Windows `cd '\\?\…'` | CI 报错原文 | Local 直启，`current_dir` 原生支持 verbatim 路径 |
| `lifecycle_tests.rs:439,626` 身份/执行渲染混比 | 断言左右两侧分别为 identity / exec | 改比 `wt_unit.worktree_path()`（identity ↔ identity） |

> `--` 与 `work_dir` 两条是**行为修复**，不属于「git 业务逻辑改动」：前者当前必然失败（无调用方
> 能依赖），后者是把已声明的参数真正用起来。PRD R3.3 已登记。

### 5.3 行为冻结的判据

新增 golden 单测（`transport/tests.rs`）：对 `["status", "--porcelain"]` +
`extra_config = [("core.autocrlf", "false")]`，断言最终 argv 为
`["-c", "core.autocrlf=false", "status", "--porcelain"]`，且 env 含
`GIT_OPTIONAL_LOCKS=0`（不重复注入、调用方覆盖优先）。timeout 断言沿用
`git_command_timeout_leaves_long_ops_unbounded`。

## 6. 兼容性与风险

| 风险 | 说明 | 缓解 |
| --- | --- | --- |
| `current_dir` 传 verbatim 路径（Windows） | `CreateProcessW` 的 `lpCurrentDirectory` 是否接受 `\\?\` | CI `backend-test`（Windows）为判据；若不接受，退路：Local 侧对 `current_dir` 单独降级（`platform` 内剥前缀，且仅作用于进程 cwd，不改 `exec()` 契约） |
| WSL/SSH 传 `sh -c script` 多一层 shell | 语义不变，多一个进程 | **已消除**：改为 `CommandExecutor::spawn_script`，脚本直接作登录 shell 执行体（见 §9） |
| 迁移面大（10+ 站点） | 单次 PR 难审 | 见 `implement.md` 分阶段；每阶段独立可验证 |
| 旧行为被无意改变 | 各站点依赖的 shell 语义（`$HOME`、管道、heredoc） | 逐站点「先写等价性测试，再迁移」；script/argv 判定表已冻结在审计清单 |

**回滚**：每个阶段一个独立提交，按 `implement.md` 的阶段边界 revert 即可；git 传输层阶段可单独
回滚而不影响其它域。

## 7. 未采纳方案

| 方案 | 否决理由 |
| --- | --- |
| 剥掉 `\\?\` 前缀（改 `UnitPath::exec`） | 违反已决策的 exec 契约（长路径支持），且不修「业务层自拼 shell」这个根因 |
| Local 保留 `sh -c`、只换路径渲染 | 仍违反红线 2；Git Bash 的 `sh` 在默认 Windows 安装里不在 PATH |
| 给 Local 加 `cmd /c` 分支、WSL/SSH 保留现状 | 把同一个决策写在 3+ 处，下一处新增调用点必然漏掉（本 bug 的成因） |
| 直接 spawn（不分环境） | 破坏 WSL/SSH 的登录 shell 与远端树杀语义 |

## 8. 记忆点（写回 spec 的候选）

- 「执行细节」与「编排」的判据（§1 判据句）。
- script 形态的**唯一**入口与 shell 选择落点。
- git 传输层的行为冻结清单（§5.3）与「transport 内 `sh -c` 合法特例」的退役。

## 9. 实现修订（审查后，2026-10-07）

初版把 script 形态的 WSL/SSH 分支实现为 facade 内 `("sh", ["-c", script])`（多一层
`sh` 的刻意取舍）。审查判定这仍让**执行知识上浮到 facade**（与 §1 判据相背），遂改为：

- 执行层新增 `CommandExecutor::spawn_script(ScriptOptions)`（**无默认实现**）；
  Local 用 `platform::shell_launch::shell_argv`，WSL/SSH 把脚本**直接作为登录 shell 的执行体**
  （前缀由 `common/executor/login_script` 单点渲染，不再嵌套 `sh -c`）。
- `core::exec::{collect_script,spawn_script}` 退化为薄封装，不再感知 shell；
  `core/exec.rs` 从护栏豁免清单移出（回归会被拦下）。
- 取消 §6「多一层 shell」风险项的取舍：多进程与知识上浮一并消除。
- `dap` 的 java debuggee 改用 `exec::spawn_script`，`platform::shell_launch::shell_argv`
  的唯一消费者收敛为 `LocalExecutor`。
