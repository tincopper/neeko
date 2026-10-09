# implement — 执行单元根唯一化

> 顺序按「先后端解析点 → 后端消费者 → 后端 IPC → 前端透传 → 前端停点读取 → 验证」排列。
> 每步完成即跑该步验证命令，不等最后一起跑。所有测试夹具路径由 `tempdir()` 推导（红线 13）。

## 0. 前置

- [ ] 读 `.trellis/spec/backend/dap-domain.md`、`.trellis/spec/backend/type-safety.md`、
      `.trellis/spec/frontend/api-layer.md`、`.trellis/spec/frontend/state-management.md`、
      `.trellis/spec/guides/cross-layer-thinking-guide.md`。
- [ ] 读 `src-tauri/AGENTS.md` 红线 3/6/8/15 与 `src/AGENTS.md` 红线 12。
- [ ] 确认 `task.py current` 指向本任务。

## 1. R1/R2 — 后端单元解析点 + 容器判据

- [ ] `src-tauri/src/dap/project_context.rs` 新增 `ExecUnit` + `resolve_unit`
      （复用 `state.resolve_repo`；`root = repo.work_dir()`；空根 fail-closed）。
- [ ] `src-tauri/src/dap/launch_support.rs`：`resolve_build_dir` 第二参改名为 `unit_root`，
      错误文案改 `"build cwd is outside the execution unit root"`，实现不动。
- [ ] 单测（`launch_support.rs #[cfg(test)]`）：`resolve_build_dir` 在「cwd 在单元根内、在项目根外」放行；
      「cwd 在单元根外」拒绝。基建用 `tempfile::tempdir()` 派生（红线 13）。
- [ ] 单测（`project_context.rs #[cfg(test)]`）：`resolve_unit(project_id, None)` → `root == project_root`；
      传入 tempdir 下的 worktree → `root == canonical(worktree)`。
- 验证：`cd src-tauri && cargo test dap::` 且 `cargo clippy -- -D warnings`（或 `pnpm lint:rust`）。
- 回滚点：新增函数 + 参数改名，`git checkout -- <file>` 即回滚。

## 2. R1 — 后端消费者改用单元根

- [ ] `dap/build.rs::build_test_binary` 增加 `worktree_path: Option<&str>`，改用 `resolve_unit`。
- [ ] `dap/launch.rs`：
  - `start_session` / `start_session_config` / `launch_session` 增加 `worktree_path` / `&ExecUnit`；
  - `launch_session` 的 `expand_config` workspace、config 读取根、`DapSession::start|connect` 的
    `project_root` 一律换 `unit.root`；
  - 移除对 `project_context::project_path` 的 import（若不再使用）。
- [ ] `dap/adapter/backend.rs`：`DebugRequest` 两变体加 `worktree_path: Option<String>`；
      新增 `pub fn worktree_path(&self) -> Option<&str>`。
- [ ] `dap/adapter/java/backend.rs`：`plan_attach` / `plan_jdtls` 改用 `resolve_unit`；
      `resolve_build_dir(&unit.target, &unit.root, cwd)`；`capability.probe(&unit.root, …)`。
- [ ] `dap/manager.rs`：`start_session` / `start_session_config` 增加 `worktree_path` 并透传。
- 验证：`cd src-tauri && cargo test dap::`（含 `DapFixture` + `FakeAdapter` 既有用例不回归）。
- 关键断言：Java `plan` 在 worktree（项目根外）下不再返回 containment 错误。

## 3. R3 后端 — IPC 契约

- [ ] `dap/commands.rs` 5 个命令新增 `worktree_path: Option<String>`：
      `dap_start_session`、`dap_start_session_config`、`debug_build_test_binary`、
      `debug_java_attach`、`debug_java_start`（命令层只加参数转发，禁平铺逻辑）。
- 验证：`cd src-tauri && cargo check`（命令层无逻辑，编译期即验证）。

## 4. R3 前端 — API wrapper + LangIo 透传

- [ ] `src/features/runner/api/debugBuildApi.ts`：`DebugBuildSpec` 加 `worktreePath`，invoke 加参。
- [ ] `src/features/runner/api/debugApi.ts`：`dapStartSession` / `dapStartSessionConfig` /
      `debugJavaAttach` / `debugJavaStart` 增加 `worktreePath: string | null`。
- [ ] `src/features/runner/languages/contract.ts`：`LangIo.runBuild` 加 `worktreePath`。
- [ ] `src/features/runner/languages/io.ts`：生产实现透传给 `buildTestBinaryRemote`。
- [ ] `src/features/runner/exec/nativeDebug.ts::runNativeBuild`：`unitRootOf(ctx) || null` 过界。
- [ ] `src/features/runner/exec/launch.ts`：`startWithConfig(ctx.projectId, unitRootOf(ctx) || null, …)`。
- [ ] `src/features/runner/store/debug/sessionSlice.ts`：`start` / `startWithConfig` 用
      `getActiveWorktreePath()` 派生并透传。
- [ ] `src/features/runner/store/javaDebugStore.ts`：`startJavaAttach` / `startJavaDebug` 同构透传（含 Rerun 重放闭包）。
- 测试：`useDebugSessionLifecycle` / `sessionSlice` / `useRunActions` / `nativeBuild` 既有用例补断言；
  新增用例断言「激活 worktree 时 invoke 带该根；无 worktree 时带 `null`」。
- 验证：`pnpm test:fe -- runner` 且 `pnpm type-check`。

## 5. R4 前端 — 停点源码可编辑

- [ ] `src/features/runner/sourceContent.ts`：`loadStopSourceContent(projectId, sourcePath, sessionId?, unitRoot?)`
      → `readFileContent(projectId, sourcePath, unitRoot ?? null)`。
- [ ] `src/features/runner/sourceOpen.ts`：`SourceOpenRequest` 加 `rootPath`；
      `fsSourceOpen(rootPath, …)` 用它做身份归一与内容 scope；`frameSourceOpen` 加 `unitRoot` 形参。
- [ ] `src/features/runner/navigate.ts`：新增单点 `unitRootFor(projectId, sessionProjectPath)`，
      `openSourceAtLine` / `ensureStopSourceTab` 全部改喂它（`projectRoot` 参数改为单元根）。
- [ ] 测试：`stopReveal.integration.test.ts` 补「激活 worktree → `readFileContent` 带 worktree root」用例。
- 验证：`pnpm test:fe -- runner`。

## 6. 收尾

- [ ] `pnpm lint`（`lint_fe` + `lint_rust`）全绿。
- [ ] `pnpm test`（fe + rust + host）全绿。
- [ ] 手工回归（macOS，Local）：默认 worktree（`~/.neeko/worktrees/<name>`）下
      ts/rust/go/java Run 通过；rust/go Debug 启动 + 断点命中 + 停点源码为可编辑 tab。
- [ ] 同步 spec：`dap-domain.md` 增「执行单元根」小节（单元解析点 + 四处派生 + 信任模型）。
- [ ] `python3 ./.trellis/scripts/add_session.py --title "..." --commit "<hash>"`。

## 依赖顺序

R1/R2（§1）→ R1 消费者（§2）→ R3 后端（§3）→ R3 前端（§4）→ R4（§5）→ §6。
§4 与 §5 可并行；§2 必须先于 §3（命令层签名依赖 manager 签名）。

## 落地记录（与计划的偏差，2026-10-08）

1. **`LangIo.runBuild` 签名不变**：计划让语言模块传 `worktreePath`，实现改为生产实现
   `languages/io.ts` **自行派生**（与 `targetPlatform` 同一模式）。语言模块彻底不感知 worktree，
   改动面更小（`java/debug.ts` / `java/env.ts` / `nativeDebug.ts` 三处调用点零改动）。
2. **launch.json 写路径也改为单元根**：计划只改读路径并登记写的缺口；实际读写同源
   （`save_configs` 也走单元根），否则 worktree 视图保存的配置落到主仓、列表读不到。
3. **`debug_java_attach` target 内联**：加 `worktree_path` 后命令达 8 参，触发 clippy
   `too_many_arguments`。改为 `JavaDebugTarget`（加 serde camelCase）作为 nested 参数，
   前端 wrapper 同步为 `debugJavaAttach(projectId, worktreePath, target)`。
4. **`ExecUnit` 不带 `key`**：无消费点，带上触发 `dead_code`（YAGNI）；后续会话按单元分槽时再加。
5. **`SourceOpenRequest` 不加 `rootPath` 字段**：`rootPath` 直接进 `load` 闭包 + `ensureSourceTab`，
   无新增冗余字段。
6. **`navigate.ts` 新增单点 `resolveUnitRoot(projectId, sessionProjectPath)`**：激活 worktree 优先 →
   会话快照 → 项目登记路径；替换原 `resolveProjectPath`。
7. **新增落点**：`runner/exec/context.ts::unitRootForProject`（命令式读单元根）；
   `dap/project_context.rs::{ExecUnit, resolve_unit, resolve_unit_root}`。

## neeko-check 违规清单修复记录（2026-10-08）

1. **[Warning] 透传测试盲区** → 已补：
   - `store/debug/__tests__/configSlice.test.ts`（新）：`loadConfigs`/`loadEntries`/`saveConfigs` 带单元根、无 worktree 带 `null`；
   - `__tests__/debugStore.test.ts`：`debugJavaAttach`/`debugJavaStart` 的 `unitRootForProject` 透传与 `null` 兜底；
   - `__tests__/navigate.test.ts`：无 worktree 读取 scope = 项目登记根；会话属 worktree A 但已切回主仓 → scope = 项目根（不产假可编辑 tab）。
2. **[Warning] `resolveUnitRoot` 优先级** → **第一性原理修正（非按原建议翻转）**：
   读取 scope 必须 = tab 空间 = 编辑器保存/重读根（三者均为**当前单元**，见 `useFileViewTabOps.worktreePathRef`）；
   若返回会话快照的单元根（可能是另一 worktree），会产下「能读不能写」的假可编辑 tab。
   故 `resolveUnitRoot(projectId, fallbackPath)` = 激活 worktree → **该项目登记根** → 兜底入参，
   **不取会话快照**。栈帧属非当前单元时回落只读外部通道 = 与保存根一致的安全降级。
3. **[Nit] 双解析点 DRY** → 抽 `project_context::unit_root(&RepoRef)`，`resolve_unit` 与 `resolve_unit_root` 共用。
4. **[Nit] Java 启动链重复解析** → `LanguageBackend::plan(&self, state, &ExecUnit, &DebugRequest)`：
   编排后端改为单元的**消费者**（单次解析）；`plan_attach`/`plan_jdtls` 不再自行 `resolve_unit`。
5. **[Nit] sessionSlice 贴顶** → 维持 ≤300（护栏通过）；`recordLaunch` 抽取已降低重复。
6. **[Nit] launch.json 写路径** → 确认为**预期**（读写同源，单元根 = worktree 工作区），已在 `dap-domain.md §2.11` 记录。

## 二次复核（独立）发现与修复（2026-10-08）

**[Block→已修] Local 保存绝对 worktree 路径被拒（能读不能写）**：
`src/features/editor/hooks/useFileViewTabOps.ts::saveFile` 的 Local 分支漏传 `rootPath`
（`writeFileContent(projectId, filePath, content)`）→ 后端 `resolve_base(None)` 以**项目根**为
containment 基准，而 tab 的 `filePath` 是**绝对 worktree 路径**（`openFile` 用 `canonicalFsPath(单元根, rel)` 产绝对），
`base.join(abs)` 后 `canonical_parent.starts_with(projectRoot)` 为假 → 拒绝。
这是**既有缺陷**（编辑器通用保存路径），但本次让停点源码 tab 变为可编辑后直接暴露，
违反 R4.3「可编辑」。修法：Local 分支与 `openFile` 读取同源，传 `rootPath ?? null`。
回归测试：`useFileViewTabOpsSaveTab.test.ts`「worktree：绝对路径以单元根为 rootPath 保存」。

**残留（本次登记，不在 Run/Debug 范围）**：`useFileTabRefresh.ts`（Local 分支
`readFileContent(projectId, tab.data.filePath)`，虽已算出 `unitRoot` 却未传）与
`useEditorSave.ts::handleReload`（同样漏 `rootPath`）—— worktree Local tab 的外部变更
**自动刷新/重载**会读失败（被 catch 静默）。属编辑器通用读写 scope 问题，另立任务。
