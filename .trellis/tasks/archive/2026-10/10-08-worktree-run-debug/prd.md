# Worktree 场景下的程序运行与调试（执行单元根唯一化）

> 状态：**规划中（未动代码）**。本文只登记需求、约束与验收标准；机制证据与设计见 `design.md`，执行计划见 `implement.md`。
> 所有 `file:line` 论断均在 2026-10-08 对当前 `main`（commit `6d64b9d9`）逐条核实。

## Goal

让 Neeko 的 Run/Debug 在「项目根 / linked worktree 根」两种仓库单元下**行为同构**：

1. **Run**（已有能力，保持不回归）：`ts / rust / go / java` 的测试用例与 main 入口，在激活 worktree 下用该 worktree 作为 cwd 执行；
2. **Debug**（本次修复）：`rust / go` 的 native debug（无头构建 → lldb/dlv）、`java` 的 attach-first 与 JDTLS 两条链路，在激活 worktree 下能启动、断点能命中、停止位置能定位到 worktree 源码；
3. **停点源码**：调试器停在 worktree 源码时，打开的是**可编辑的项目内文件**（不是只读的「外部源码」）。

## Problem Statement（用户可观察症状）

前置事实：git worktree 的默认创建路径是 `${home}/.neeko/worktrees/${name}`（`src/shared/components/GitDialog.tsx:121`），
**恒在项目根之外**。而 `src-tauri/src/common/git/path_guard.rs` 已明文承认 worktree 路径「可在项目根之外，不能强制 containment」。

| 症状 | 现场形态 |
| --- | --- |
| S1 Debug 直接失败 | 在 worktree 里点 Debug（rust/go/java）：无头构建报 `build cwd is outside the project root`，或 JVM 未拉起；Debug Console 报错 |
| S2 断点永不命中 / 源码错位 | 若绕过 S1（worktree 恰好落在项目根内，如 `<root>/.worktrees/x`），适配器 workspace 仍是**主仓根**：`${workspaceFolder}` 展开成主仓、源码解析基准错位 |
| S3 停点源码只读 | 即使会话起来了，停在 worktree 文件时打开的是「外部只读」tab（无法保存、无脏标记），因为项目内读取以主仓根为 scope，worktree 文件被判越界后回落外部通道 |
| S4 launch.json 不可见 | worktree 自带的 `.vscode/launch.json` / 入口点发现读的是主仓根 |

**Run 路径本身是对的**（S1-S4 不含 Run）：`resolveRunCwd()`（`src/features/runner/exec/context.ts:20`）已优先取激活 worktree，PTY 会话 cwd 已接受 worktree 路径；测试 `useRunActions.test.ts:182,1325` 已钉住。**坏的只是 debug 通道 + 停点源码读取。**

## 问题本质（第一性原理）

一次 Run/Debug 的真值依赖是 `(仓库单元, 目标, 环境)`，而不是 `(项目, 目标, 环境)`。

三条系统不变量，当前**部分不成立**（证据编号 → `design.md` §2 的 D1-D7）：

- **I1 单元根不变量**：命令 cwd、适配器 workspace、`${workspaceFolder}` 展开、launch.json 读取根、构建目录校验基准，必须**全部**由同一个「执行单元根」派生。主仓是 `unitRoot == projectRoot` 的退化取值，不允许有第二条代码路径。
  现状：Run 侧成立（`resolveRunCwd`），Debug 侧**全部按项目根**（D1/D2/D3/D6）。
- **I2 容器不变量**：`cwd` 的合法性判据必须是「落在**单元根**内」。worktree 在项目根之外是**合法**的，不是越界。
  现状：`resolve_build_dir` 以项目根为基准（D1），于是 S1 在默认路径下**必现**。
- **I3 身份不变量**：停点源码的项目内读取 scope 必须与 tab 身份空间同基准（`resolveTabKey(projectId, activeWorktreePath)`）。
  现状：`loadStopSourceContent` 用缺省 root = 项目根（D5），于是 S3 必现。

**推论**：S1/S2/S3/S4 不是四个独立 bug，而是同一「单元根缺失」的四种投影。逐个打补丁（如给 `resolve_build_dir` 加 worktree 前缀白名单）只会把 worktree 知识渗进通用层，新增一条需要维护的偶然条件。

## Scope

### In

- 后端：新增唯一单元解析点 `ExecUnit`（基于既有 `AppStateWrapper::resolve_repo` / `RepoRef`），
  DAP 的所有路径事实（构建 cwd 校验、适配器 workspace、变量展开、launch.json 读取、Java 两条链路的 cwd/probe 根）改为由它派生。
- 后端：5 个 DAP 命令增加 `worktree_path: Option<String>` 入参（与 git 域 18 个命令**逐字同形**）。
- 前端：`LangIo` / `debugApi` / `debugBuildApi` 透传单元根；停点源码读取补齐 `rootPath`。
- 测试：后端 `resolve_build_dir` 的单元根语义单测；前端 worktree 全链路透传断言。

### Out（明确不做，但不得恶化）

- **新增语言**：Python 运行/调试、TS/Node 调试。它们是「新增语言能力」，与 worktree 正交，另立任务（`design.md` §6 给出扩展点证明）。
- **LSP 会话跟随 worktree 根**：全应用 LSP 现按项目根作会话键（`useLspDefinition.ts:100`、`symbolNavStore.ts:120`、`FileViewer.tsx:83`），runner 的 overlay 只是**与之一致**。改它是编辑器全域改动，另立任务。
- **并行调试**：`launch.rs` 维持「一个项目一个活动会话」。把会话表键从 `projectId` 改成 `unitKey` 影响断点/mute 存储，另立任务。
- **WSL / SSH 的 worktree 场景**：远端 worktree 创建尚未支持；本次只保证远端路径不回归（`resolve_unit` 对远端走词法归一）。
- Rerun / 断点持久化 / DebugPanel UI 结构：功能语义不变。

## Requirements

### R1 单元根唯一化（I1）

- R1.1 必须存在**唯一**的「执行单元根」解析点，复用既有 `RepoRef`（`common/git/repo_ref.rs:92`）与
  `AppStateWrapper::resolve_repo`（`app_state.rs:150`），禁止新造第二套路径归一。
- R1.2 DAP 的下列事实必须由单元根派生，禁止继续读项目根：
  - `resolve_build_dir` 的 containment 基准（`dap/launch_support.rs:15`）；
  - `expand_config` 的 `workspace`（`dap/launch.rs:104`）；
  - 会话 `project_path`（adapter 子进程 cwd / `build_launch_args` workspace / 外部源码判定根，`dap/session.rs:105,281,553`）；
  - `launch_config::load_or_discover` 的读取根与 `pick_config_for_file` 的 workspace（`dap/launch.rs:49,57`）；
  - Java `plan_attach` / `plan_jdtls` 的 `resolve_project` + `resolve_build_dir` + `capability.probe` 根（`adapter/java/backend.rs:135,139,216,235,271`）。
- R1.3 主仓单元（`worktree_path = None` 或等值于项目根）必须以**同一路径**产出 `unitRoot == projectRoot`，不得出现行为分叉。

### R2 容器判据正确（I2）

- R2.1 `resolve_build_dir` 的 Local 分支判据改为「canonical cwd 落在 canonical **单元根**之内」；错误文案不得再声称「outside the project root」。
- R2.2 空 `cwd` / 空单元根 / 不可 canonicalize 一律 fail-closed，不得 `to_string_lossy` 换成另一个路径（对齐 `dap-domain.md` §2.6）。
- R2.3 远端的词法 NUL 拒绝语义不变。

### R3 IPC 契约对齐（跨栈）

- R3.1 `dap_start_session`、`dap_start_session_config`、`debug_build_test_binary`、`debug_java_attach`、`debug_java_start` 增加 `worktree_path: Option<String>`；前端 wrapper 同步传 `worktreePath`。
- R3.2 参数形态与 git 域既有命令一致（`worktree_path: Option<String>` + `resolve_repo`），前端不学习第二套约定。
- R3.3 前端 `LangIo` 仍是语言模块唯一 IO 通道；语言模块**不得**感知 worktree（新增入参只出现在 `LangIo` 实现与 API wrapper）。

### R4 停点源码可编辑（I3）

- R4.1 停点源码的项目内读取必须带上单元根作为 `InProject` scope（复用既有 `read_file_content(rootPath)` 与 `resolve_base`）。
- R4.2 项目根 / worktree 根的派生必须**单点**：`navigate.ts` 的基准解析只允许一处，禁止消费侧自造字符串归一（前端红线 12）。
- R4.3 worktree 源码打开后 entered tab 必须是可编辑项目内 tab（非 read-only），且与文件树打开的同一文件复用同一 tab（`sameFileAt` 命中）。

## Acceptance Criteria

1. 后端单测：`resolve_build_dir` 在「cwd 落在单元根内但在项目根外」时放行；「cwd 落在单元根外」时拒绝（tempdir 推导路径，红线 13）。
2. 后端单测：`resolve_unit` 在 `worktree_path = None` 时 `root == project_root`；在 worktree 时 `root == canonical(worktree)`。
3. 后端测试：Java `plan` / native build 在 worktree（项目根外）下不再因 containment 失败（`DapFixture` + 现有 fake 端口）。
4. 前端测试：`dapStartSession` / `dapStartSessionConfig` / `debugBuild` / `debugJavaAttach` / `debugJavaStart` 的 invoke 载荷携带激活 worktree 根；无激活 worktree 时传 `null`。
5. 前端测试：`loadStopSourceContent` 在传入单元根时以该根作为 `readFileContent` 的 `rootPath`。
6. `pnpm lint`（含 `lint_fe` + `lint_rust`）与 `pnpm test`（fe + rust + host）全绿。
7. 手工回归（macOS，Local）：`ts / rust / go / java` 四门语言在默认 worktree（`~/.neeko/worktrees/<name>`）下 Run 通过；`rust / go` Debug 会话启动 + 断点命中 + 停在 worktree 源码为可编辑 tab。

## 已知缺口（本次不修，登记）

- LSP 会话仍以项目根为键 → worktree 下 `rust-analyzer experimental/runnables` 与 jdtls `documentSymbol` 富化可能缺失（runner 静默回落快路径）。属 Part 4。
- 远端（WSL/SSH）worktree 未支持。
- Python / TS 调试未支持。属 Part 2/3。
