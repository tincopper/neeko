# 实施计划：统一命令执行标准

> 前置：`prd.md`（验收）、`design.md`（契约）、`research/command-execution-audit.md`（清单）。
> 硬闸门：本文件与 PRD/设计经用户确认后，才允许 `task.py start` 并改码。

## 阶段划分与提交边界

每阶段 = 一个独立提交 + 一个可独立验证的判据。阶段顺序即依赖顺序（P0 是所有后续的前置）。

### P0 — 统一层：补 Local 的 script 形态

- [x] `platform/shell_launch/{mod,windows,unix}.rs` 增 `shell_argv(script) -> (&'static str, [&str; 2])`
      （从 `dap/launch_support.rs:88-103` 上收，签名逐字保留）；`mod.rs` 仍纯声明。
- [x] `core/exec.rs` 增 `collect_script(target, script, cwd, env)` + `run_script(target, script)`。
- [x] 单测：Local 脚本语义（`exit` 码、stderr、cwd、env 生效，跨平台）+ 平台 program 断言。

**验证**：`pnpm test:rust`（本机）。
**回滚**：单提交，`git revert`。

### P1 — 护栏 + 标准写回 spec（先拦后改）

- [x] `tools/guards/checks/check_command_execution.py`：V1/V2/V3 三类判据（排除测试、`platform/`、
      `common/executor/`、`terminal/`、`common/utils/command/` 与统一层 `core/exec.rs`）。
- [x] 护栏负例测试（`tools/guards/tests/test_check_command_execution.py`，9 例：V1/V2/V3、正例、
      豁免、`#[cfg(test)]` 块、测试文件）。
- [x] 更新 `.trellis/spec/backend/`：新增 `command-execution.md`（统一标准）；退役
      `git-domain.md:227-228` 的「合法特例」段；更正 `executor/env_defaults.rs` 模块注释措辞；
      更新 `run_shell_streaming` → `run_spawn_streaming` 的引用。

**判据**：护栏接入 `pnpm lint`（`--stage local`）与 CI（`--stage ci`），全仓 338 个生产文件 0 违规。
**回滚**：护栏与文档独立提交。

### P2 — git 传输层迁移 + Windows 回归收敛

- [x] `transport/mod.rs`：`run_shell_streaming` → `run_spawn_streaming(SpawnOptions, label, timeout, hooks)`；
      `impl GitTransport for ExecTarget::run_git_opts_streaming` 三端合一（argv 形态）。
- [x] 删 `transport/{local,wsl,ssh}.rs` 的 `run_git_*`；删 `shell_quote`、`safe_path` 依赖、
      误插的 `--`；`run_git_with_stdin` 走 argv + `current_dir` + env。
- [x] golden 单测：argv 逐字（§5.3）、空 `work_dir` 仍拒绝（`should_inject_env_into_git` /
      `git_status_does_not_refresh_index` / `should_feed_stdin_to_git_hash_object` 仍绿）。
- [x] 修 `lifecycle_tests.rs:439,626`（identity ↔ identity）。

**验证**：`pnpm test:rust`（本机逐条跑 `git::services::status` /
`common::file::watcher::manager`）；**Windows 判据 = CI `backend-test`**（本地不可复现）。
**回滚**：独立提交，回滚不影响其它域。
**风险点**：`Command::current_dir` 接受 verbatim 路径（见 `design.md` §6，退路已写明）。

### P3 — 业务域迁移（按审计清单 §2.2）

- [x] `dap/process.rs::run_pre_launch_task` → `exec::collect_script`；`dap/launch_support.rs`
      的 `build_shell_argv` 删除（build.rs 用 `collect_script`、java backend 用
      `platform::shell_launch::shell_argv`）。
- [x] `theme/pi.rs` / `theme/opencode.rs`：mkdir/stat/test/cat → argv；base64 写 → script。
- [x] `connection/commands.rs`、`connection/services.rs` → `printenv HOME`（argv）；
      `ls|grep|sed` → `run_script`。
- [x] `agent/commands_commit.rs` → `run_script`（`build_agent_commit_cmd` 产出的命令串）。
- [x] `common/file/services/*` + `common/file/reader.rs`：mkdir/touch/find/test/rm/mv/stat/head/cat → argv；
      heredoc/base64 写、`git ls-files` → argv/script；删 `shell_cmd.rs`。
- [x] `core/exec.rs::command_exists` 的 WSL/SSH 分支 → `run_script`。

**验证**：`pnpm test:rust` 全绿；护栏命中数归零。

### P4 — `common/utils/fonts.rs` 平台化收口

- [x] Windows/Linux 的字体枚举实现迁 `platform/fonts/{macos,windows,linux,default}.rs`
      （红线 10），命令经 `core::exec::collect_blocking` 执行（红线 1）；
      `common/utils/fonts.rs` 只保留编排（缓存 / 私有字体过滤 / 排序去重）。

**验证**：`pnpm test:rust` + `pnpm lint:rust` 通过。

### P5 — 收尾

- [x] 复跑审计 §4 三条 grep：生产代码零命中（新护栏 `check_command_execution` = 全仓 0 违规）。
- [x] `pnpm lint`（含全部护栏）、`pnpm test:rust`（`test:rust` 本机全绿）。
- [ ] CI 三平台 `backend-test` 复核（Windows `\\?\` 回归由 CI 给出最终判据）。
- [x] `trellis-update-spec`：把 §8 记忆点写回 spec（`command-execution.md`）。

## 全量验证命令

```bash
pnpm lint                 # eslint + tsc + fmt + clippy + guards
pnpm test:rust            # 本机；Windows 判据由 CI backend-test 提供
python3 tools/guards/run.py run --stage repo   # 新护栏单独跑
rg -n '"sh"|"bash"|"cmd"|"powershell' src-tauri/src --type rust -g '!**/*test*'   # 期望：仅 platform/ 与统一层
```

## 验收映射

| AC | 判据 |
| --- | --- |
| AC1 | CI `backend-test`（win/mac/linux）全绿 |
| AC2 | golden argv/env/timeout 测试 + `check_git_optional_locks_single_source` |
| AC3 | 审计 §4 三条 grep 生产代码零命中 |
| AC4 | 新护栏负例测试 + `pnpm lint` 接入 |
| AC5 | `collect_script` 单测（含 Windows program=`cmd` 断言） |
| AC6 | `pnpm lint` 全绿 |

## P6 — 审查后修复（neeko-check 违规清单）

- [x] **W1（内聚/可扩展）**：script 形态下沉 `CommandExecutor::spawn_script(ScriptOptions)`；
      Local 用 `platform::shell_launch::shell_argv`，WSL/SSH 用 `common/executor/login_script`
      直接作登录脚本体；facade 变薄；`core/exec.rs` 移出护栏豁免；java debuggee 改用 `spawn_script`。
- [x] **W2（复用/测试）**：新增 `common/executor/login_script`（3 测试）、
      `common/utils/command/local::base64_write_script`（1 测试）；`theme/common.rs` 抽
      `wsl_target` / `ensure_wsl_dir` / `write_wsl_file` / `read_wsl_file` / `backup_wsl_file_once` /
      `sync_wsl_theme_json`，pi/opencode 两处重复的「mkdir→备份→读合并→写」收敛为一处。
- [x] **W3（护栏边界）**：`command-execution.md` 写明 V1 只收「shell 名直接作 cmd」的静态可判定射程。
- [x] **N1**：`ensure_parent_dir` 非 UTF-8 父路径显式报错（不再静默跳过）。
- [x] **N4**：`command_exists` 标注 `cmd` 为受信静态命令名。
- [x] **N5**：`git-domain.md` §9 登记 `ignored_cache` 的远端 `ls-files` 例外与判据。

## 待用户确认的判定（阻塞规划完成）

1. **任务结构**：本任务体量大且可分域独立验收。
   - 推荐：**保持单任务**，用上面 P0–P5 的阶段提交；理由：P0 是公共前置，拆分后子任务无法独立
     合入（C1 未落地时其余迁移无处可去），而 P3 各域之间是机械同构、无交叉决策。
   - 备选：`10-07-unify-command-execution` 作 parent，另建 git / file-services / dap+theme+connection+agent
     三个 child。代价：多 3 个任务目录与 3 次 review，收益是可并行、PR 更小。
2. **P1 先落护栏再迁移**（先拦后改）是否符合预期？推荐是——它能在迁移前给出「全仓还有多少违规」
   的量化基线。
