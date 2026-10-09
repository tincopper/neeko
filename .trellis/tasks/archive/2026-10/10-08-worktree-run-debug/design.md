# design — 执行单元根唯一化

> 配套 `prd.md`。本文给出机制证据（逐条 `file:line`）、设计决策与接口契约。
> 判据与例外以落点 spec 为准：`.trellis/spec/backend/dap-domain.md`、`.trellis/spec/backend/type-safety.md`、
> `.trellis/spec/frontend/state-management.md`、`.trellis/spec/guides/cross-layer-thinking-guide.md`。

---

## 1. 核心决策：复用 `RepoRef` 作为唯一单元解析

仓库里已经有「仓库单元」的一等抽象，**不新造概念**：

| 既有件 | 落点 | 提供 |
| --- | --- | --- |
| `RepoRef::resolve(project_id, project_root, worktree_path, target)` | `src-tauri/src/common/git/repo_ref.rs:92` | 校验 + canonicalize + 「worktreePath 等于项目根 ⇒ 主仓」收敛 |
| `RepoRef::work_dir()` | `common/git/repo_ref.rs:155` | 单元根的 **exec 形态**（宿主分隔符 / 远端 POSIX） |
| `RepoRef::key()` | `common/git/repo_ref.rs:180` | 双端寻址身份（前端 `RepoKey`） |
| `AppStateWrapper::resolve_repo(project_id, worktree_path)` | `src-tauri/src/app_state.rs:150` | 上述的异步入口（阻塞 fs 已在 `spawn_blocking` 内，红线 3） |

**git 域 18 个命令已统一用 `state.resolve_repo(&project_id, worktree_path.as_deref())`**（`git/commands/*.rs`）。
本次做的只是让 DAP 域采用**同一个 seam**。

### 1.1 新增 `ExecUnit`（`dap/project_context.rs`）

```rust
pub struct ExecUnit {
    pub target: ExecTarget,  // 执行环境（Local / WSL / SSH）
    pub root: String,        // RepoRef::work_dir() —— 单元根（exec 形态）
}

pub async fn resolve_unit(
    state: &AppStateWrapper,
    project_id: &str,
    worktree_path: Option<&str>,
) -> Result<ExecUnit, AppError>;
```

- **为什么是值对象不是 trait**：消费侧（launch / build / java backend）只需要「一个根 + 一个环境」，
  不需要多态。值对象让 `resolve_unit` 成为唯一生产者，`ExecUnit` 成为唯一载体。
- **不携带身份键**：会话按单元分槽属后续项；在那之前 `RepoRef::key()` 没有消费点，
  带上只会触发 `dead_code`（违背 YAGNI）。将来按单元分槽时在 `ExecUnit` 加 `key`，消费侧零改动。
- **`project_path()` 保留**：`launch_config` 的配置读写走单元根（见 §3.3），但 `project_path`
  仍被其他调用点（如 error 文案）使用。

### 1.2 不改的东西（范围纪律）

- 不引入 `UnitPath` 的新用法：`RepoRef` 已包了 `UnitPath`（identity/exec 双渲染），DAP 只消费 `work_dir()`（exec 形态）。
- 不给语言模块加 worktree 参数：语言模块只看到 `cwd` / `runRoot`，由通用层从 `ExecUnit` 填入。

---

## 2. 机制证据（当前违反点）

> 全部在 2026-10-08 对 `6d64b9d9` 核实。

| 编号 | 落点 | 现状 | 违反 |
| --- | --- | --- | --- |
| D1 | `dap/launch_support.rs:15` `resolve_build_dir(target, project_root, cwd)` | Local 分支要求 `canonical(cwd).starts_with(canonical(project_root))`，否则 `"build cwd is outside the project root"` | I2 |
| D2 | `dap/build.rs:45-46` | `resolve_project(project_id)` 取项目根 → 传给 D1 | I1/I2 |
| D3 | `dap/launch.rs:104` | `expand_config(&raw_config, &path, …)` 的 `path` = `project_path()` | I1 |
| D4 | `dap/session.rs:105,129,281,553` | 会话 `project_path` = 项目根；它同时是 adapter cwd、`build_launch_args` 的 workspace、外部源码判定根、回传前端的 `projectPath` | I1/I3 |
| D5 | `src/features/runner/sourceContent.ts:79` | `readFileContent(projectId, sourcePath, null)` → 缺省 root = 项目根；worktree 文件读失败后回落 `dapReadExternalSource` | I3 |
| D6 | `dap/launch.rs:49,57` | `launch_config::load_or_discover(&path)` + `pick_config_for_file(…, &path)` 用项目根 | I1 |
| D7 | `dap/adapter/java/backend.rs:135,139,216,235,271` | `plan_attach` 与 `plan_jdtls` 各自 `resolve_project` + `resolve_build_dir(project_root)`；jdtls 能力探测 `probe(&project_root, …)` 也在项目根 | I1/I2 |
| D8 | `dap/commands.rs:61,83,276,292,335` | 5 个命令无 `worktree_path` 入参 | 跨栈 |

**Run 侧已正确**（不在改动范围）：`src/features/runner/exec/context.ts:20 resolveRunCwd` 取激活 worktree；
`exec/launch.ts` 用 `plan.cwd` 起 Task；`TaskStore.runTask(cmd, cfg, {cwd})` 接受 worktree cwd。

---

## 3. 关键设计判断

### 3.1 `resolve_build_dir` 的基准从「项目根」改成「单元根」

判据从「cwd ∈ projectRoot」变为「cwd ∈ unitRoot」。合法性论证：

- **unitRoot 是受信形态**：它由 `RepoRef::resolve` 产出（`path_guard::lexical_worktree_check` 拒绝 `..`/NUL + Local canonicalize），
  不是前端原样字符串。红线 8「前端传入路径消费前必须 canonicalize」由此满足。
- **cwd 的真实上界就是 unitRoot**：前端 `resolveRunCwd` 给出 run 根（= unitRoot），
  语言模块只把它**收窄**到模块根（Java 多模块 / Rust 清单目录），从不越出单元。
- **默认 worktree 在项目根外是合法输入**（`GitDialog.tsx:121` + `path_guard.rs` 模块注释），
  旧判据原理上错误，不是漏改一处。

**信任模型**：与 git 域**逐字一致** —— 前端 `worktreeStore` 是单元清单的事实源，后端只做词法 + canonicalize，
不额外调 `git worktree list` 验成员资格（那会给每次 debug 构建加一次进程开销，且与 git 域信任级别不一致）。
此决策记录在案；若将来要强校验，落点应在 `resolve_unit`（单点），消费侧不变。

### 3.2 会话 `project_path` 一次性承载四个消费点

`DapSession::project_path` 同时被用于：

1. `process::spawn_adapter(&target, &project_path, …)`（`session.rs:129`）→ adapter 子进程 cwd；
2. `plugin.build_launch_args(config, project_path)`（`session.rs:281`）→ `workspaceFolder` 展开；
3. 外部源码「是否项目内」判定根（`session.rs:553`）；
4. `DapSessionInfo.project_path` → 前端 `live.projectPath` → `buildStopLocation` 的身份基准。

把它换成 `unit.root`，四个消费点**同一个 diff 内**收敛。这是收益/风险比最高的一处改动：
不改任何消费点代码，只改传入值。

### 3.3 launch.json 读写根：项目根 → 单元根

`.vscode/launch.json` 是工作区文件，worktree 有自己的一份（git 管理）。**读与写同源**：
`list_or_discover_configs` / `save_configs` / `discover_entry_points` / `start_session` 全部走单元根。
若只改读不改写，在 worktree 视图保存的配置会落到主仓、下次列表读不到（"我保存了却没生效"）。

**信任边界**：`dap_save_configs` 写入单元根下的 `.vscode/launch.json`，与文件编辑能力同等信任
（不新增任意路径写口：单元根由 `RepoRef::resolve` 校验，不可表示/含 `..` 即拒）。

### 3.4 停点源码读取（D5）

前端已有正确的后端能力：`read_file_content(project_id, file_path, root_path)` + `resolve_base`（`file/commands.rs:53`）
已支持 worktree 根（注释逐字写着「传入的 base 若是某个工作树根」）。缺的只是前端把 root 传下去。

设计：`SourceOpenRequest` 的 `load` 闭包带上 `rootPath`，作为**同一个基准**服务于：

- `fileRefFromTabPath(rootPath, sourcePath)` 身份归一；
- `loadStopSourceContent(…, rootPath)` 的 `InProject` scope；
- `ensureSourceTab` 的 `sameFileAt(rootPath, …)` 复用查找。

基准派生单点：`navigate.ts` 内 `resolveUnitRoot(projectId, fallbackPath)`，取值 = **当前执行单元**
（激活 worktree 根 → 该项目登记根 → 兜底入参）。**不变量**：读取 scope 必须等于 tab 空间与
编辑器保存根（`useFileViewTabOps` 的 `worktreePathRef`）—— 三者同源于当前单元；否则栈帧属
另一单元时会产出「能读不能写」的假可编辑 tab。因此**有意不优先会话快照的单元根**：会话属于
非当前单元时，其栈帧落在当前单元根之外 → 回落只读外部通道（安全降级），与 `resolveRunCwd` 同源。

### 3.5 前端透传路径

```
editor gutter / debug toolbar
  └─ runner/exec/context.ts  unitRootOf(ctx) = resolveRunCwd(ctx)   ← 唯一派生点
       ├─ exec/nativeDebug.ts ──► LangIo.runBuild({ projectId, worktreePath, command, cwd })
       │                              └─ api/debugBuildApi.ts ──► debug_build_test_binary
       ├─ store/debug/sessionSlice.ts ──► dapStartSession(projectId, worktreePath, …)
       │                                    └─ api/debugApi.ts ──► dap_start_session
       └─ store/javaDebugStore.ts ──► debugJavaAttach / debugJavaStart（同带 worktreePath）
```

`sessionSlice` / `javaDebugStore` 是**命令式**上下文（非渲染），用 `getActiveWorktreePath()`（`worktreeStore.ts` 提供的命令式读取）
派生单元根，与 `resolveRunCwd` 同源。

---

## 4. 接口契约（新增/变更签名）

### 4.1 Rust

```rust
// dap/project_context.rs（新增）
pub struct ExecUnit { pub target: ExecTarget, pub root: String, pub key: String }
pub async fn resolve_unit(state: &AppStateWrapper, project_id: &str, worktree_path: Option<&str>)
    -> Result<ExecUnit, AppError>;

// dap/launch_support.rs（语义变更：基准 = 单元根；签名参数改名）
pub(crate) async fn resolve_build_dir(target: &ExecTarget, unit_root: &str, cwd: &str)
    -> Result<String, AppError>;

// dap/build.rs（新增入参）
pub async fn build_test_binary(state: &AppStateWrapper, project_id: &str,
    worktree_path: Option<&str>, command: &str, cwd: &str) -> Result<DebugBuildOutput, AppError>;

// dap/launch.rs（新增入参；launch_session 改为接收 &ExecUnit）
pub(crate) async fn start_session(ctx, sink, project_id: &str, worktree_path: Option<&str>,
    config_name: Option<String>, current_file: Option<String>) -> Result<DapSessionInfo, AppError>;
pub(crate) async fn start_session_config(ctx, sink, project_id: &str,
    worktree_path: Option<&str>, raw_config: LaunchConfig) -> Result<DapSessionInfo, AppError>;
pub(crate) async fn launch_session(ctx, sink, project_id: &str, unit: &ExecUnit,
    raw_config: LaunchConfig, current_file: Option<&str>, route: SessionRoute<'_>) -> Result<DapSessionInfo, AppError>;

// dap/adapter/backend.rs（每个变体加 worktree_path；新增同构访问器）
pub enum DebugRequest {
    JavaAttach { project_id: String, worktree_path: Option<String>, target: JavaDebugTarget },
    JavaJdtls  { project_id: String, worktree_path: Option<String>, target: JavaJdtlsTarget },
}
impl DebugRequest { pub fn worktree_path(&self) -> Option<&str>; }

// 编排后端是单元的**消费者**（单次解析，低耦合）：
async fn plan(&self, state: &AppStateWrapper, unit: &ExecUnit, request: &DebugRequest)
    -> Result<SessionPlan, AppError>;

// dap/commands.rs（5 个命令新增 worktree_path: Option<String>）
dap_start_session(app, state, project_id, worktree_path, config_name, current_file)
dap_start_session_config(app, state, project_id, worktree_path, config)
debug_build_test_binary(state, project_id, worktree_path, command, cwd)
debug_java_attach(app, state, project_id, worktree_path, command, cwd, test_name, classpath)
debug_java_start(app, state, project_id, worktree_path, target)
```

### 4.2 TypeScript

```ts
// runner/api/debugBuildApi.ts（内部）
interface DebugBuildSpec { projectId: string; worktreePath: string | null; command: string; cwd: string }

// runner/api/debugApi.ts
interface JavaAttachTarget { command: string; cwd: string; testName: string; classpath: string[] }
dapListConfigs(projectId, worktreePath: string | null)
dapSaveConfigs(projectId, worktreePath: string | null, configurations)
dapDiscoverEntries(projectId, worktreePath: string | null)
dapStartSession(projectId, worktreePath: string | null, configName?, currentFile?)
dapStartSessionConfig(projectId, worktreePath: string | null, config: LaunchConfig)
debugJavaAttach(projectId, worktreePath: string | null, target: JavaAttachTarget)
debugJavaStart(projectId, worktreePath: string | null, target: JavaJdtlsTarget)

// runner/languages/contract.ts —— LangIo.runBuild 签名**不变**（语言模块不感知 worktree）：
//   runBuild(spec: { projectId, command, cwd })
// 生产实现 io.ts 自行派生 worktreePath（与 targetPlatform 同一模式）后转给 debugBuildApi。
```

参数命名遵守 Tauri 约定：前端 wrapper 用 camelCase（`worktreePath`），Rust 用 snake_case（`worktree_path`），
与 git 域既有 wrapper 一致（`.trellis/spec/frontend/api-layer.md`）。

---

## 5. 扩展点证明（只加代码/配置，不改核心）

| 未来需求 | 需要新增 | 核心逻辑改动 |
| --- | --- | --- |
| Python 运行 | `RunLang` 联合加 `'python'` + `languages/python/index.ts` + `registry.ts` 一行 | 0（`Record<RunLang, LanguageModule>` 漏注册编译失败） |
| Python 调试 | `AdapterKind::Python` + plugin + `LanguageBackend` + `register_backend`；`DebugRequest` 加变体 | 0（`kind()` 的 `match` 强制补分支） |
| TS/Node 调试 | 同上，`AdapterKind::Node` + js-debug plugin | 0 |
| 修改 worktree 默认创建路径 | `GitDialog.tsx` 一处 | 0（DAP 不感知具体路径，只消费单元根） |

本设计**不新增**任何「语言 == xxx」分支（红线 15），也不在通用模块平铺 worktree 特例。

---

## 6. 风险与缓解

| 风险 | 缓解 |
| --- | --- |
| 单元根信任模型弱于「项目根 containment」 | 与 git 域同一模型；`resolve_unit` 单点可在未来加 `git worktree list` 校验，消费侧不变 |
| `debug_java_start` 的 jdtls 探测在 worktree 根上跑，可能返回 Warming（jdtls 未在 worktree 建项目） | 这是**正确**行为（不做自动换引擎，`design §2.5` 承诺）；前端已有 Warming 文案，不改 |
| launch.json 读取根改成单元根后，worktree 无 `.vscode/launch.json` → 走 `load_or_discover` | 行为与主仓一致（缺省发现入口点）；不新增错误路径 |
| 会话 `project_path` 变化影响外部源码授权判定 | 变化方向是**放宽**（worktree 源码从「外部」变「项目内」），不会拒绝原本可读的路径 |
| `RepoRef` 的 `unit_root` 与前端 `worktreeStore` 的路径形态不一致（identity vs exec） | 后端统一取 `work_dir()`（exec 形态）作为 cwd/workspace；前端传的是 canonical 形态，`RepoRef::resolve` 内部再归一 |
