# 监听边界与成本模型：ignored 子树零监听、可排除的物理边界、粗粒度失效

## Goal

让**被 `.gitignore` 忽略的子树在物理层不被监听**（不再"OS 全收、回调丢弃"），并把
「监听边界」从**逻辑语义**（gitignore）提升为**可物理实现的 watch manifest**；
同时把过载降级方向从"扩大爆炸半径"改为"粗化失效"。

一句话：**监听集合 ≈ 依赖集合**（既补上界，也保下界）。

## 背景（问题证据）

来源：对 `pnpm check` 24m28s 的耗时分析（详见 `research/raw-perf-evidence.md`）。根因链：

1. `src-tauri/target/` 膨胀到 **353GB**，`target/debug/deps` 单目录 **883,175 个条目**，
   其中 **769,482 个**.o** 是本项目自己的 CGU 目标文件（无 `[profile]` 覆盖 → dev 全量 debuginfo，
   `libneeko_lib.a` 844MB）。
2. macOS 上 Neeko 对**整个项目根做递归监听**（`WatchStrategy::Recursive`），ignored 子树
   只在回调里丢弃 → `fseventsd` 长期 ~100% CPU，Spotlight 已索引 30 万个 `.o`。
3. `cargo test` 实测 real 689s / libtest 自报 315s、CPU 仅 ~18s；13 条测试 >60s，集中在
   `common/file/watcher/manager/lifecycle_tests`（真实 FSEvents + 8s 超时）。
4. **结构事件（Create/Remove/Rename）不按 gitignore 过滤**（`classify.rs::structure_event_paths`
   只排除 `.git`/`.DS_Store`）→ `target/**` 的构建 churn 会一路发到前端；`TREE_CHANGED_MAX_DIRS=64`
   超限即清空集合 = **全树重扫**。

结论：正确性公理（`git-domain.md §14`：监听集合 ⊇ 依赖集合）只约束了**下界**，
方案用"最大化过近似"去满足它，**缺的是上界（成本）契约**。

## 工作流（Workstreams，单任务内管理）

**不新建 Trellis 子任务目录**（D0/D3）：所有工作流在本任务内管理 ——
`task.json.subtasks` 记录名字，`implement.md` 记录顺序、验证与回滚点。
每项可独立验收、独立 revert：

| 工作流 | 交付物 | 依赖/顺序 |
| --- | --- | --- |
| `watch-manifest-contract` | 抽出 `WatchManifest` + `WatchBackend` 能力位，**行为不变**（纯重构底座） | 无；先做 |
| `ignored-structure-events` | 结构事件不再泄漏 ignored 子树（跨平台、纯回调内） | 依赖底座 |
| `user-watcher-exclude` | VS Code `files.watcherExclude` 式用户排除（D2） | 依赖底座 |
| `tree-read-entry-cap` | 读层条目上限 + truncated + ignored 目录按需展开 | 独立，可最先并行 |
| `macos-fsevent-exclusion` | macOS 物理排除 ignored 子树（A 落地 + 运行时回退开关） | 依赖底座 + `ignored-structure-events` |

## Requirements

- **R1（ignored 零监听）**：任意平台上，被该单元 gitignore（`should_ignore_own`）忽略的目录，
  其**内部**不产生监听事件、不进入回调。ignored 目录**自身的出现/消失**仍须被感知（用于灰节点）。
- **R2（边界一等化）**：监听边界是一个显式集合（watch manifest），由"可见目录集合"生成，
  gitignore 只是它的输入之一；禁止把"事件过滤"当作边界实现（macOS 现状）。
- **R3（平台能力位）**：把"后端能否真正排除子树"抽成**单一能力位**并落 `src/platform/`
  （红线 10）；不能排除的平台降级为**更粗的失效粒度**，而非逐事件处理。
- **R4（结构事件）**：结构事件（Create/Remove/Rename）不得把 ignored 子树**内部**路径当刷新目标；
  ignored 根的边界变化由父目录（可见目录）监听捕获。
- **R5（降级方向）**：过载降级必须**收敛**——caps 溢出时发出粗粒度失效（"该子树可能 stale"），
  禁止"溢出 → 扩成整树注册 / 全树重扫"。
- **R6（opens 例外显式化）**：被忽略的**已打开文件**不随外部变化 live-refresh —— 这是既有行为
  （内容事件已按 gitignore 过滤），本任务必须将其记录为显式契约/例外，而不是沉默。
- **R7（读层有界）**：ignored 目录"点击再加载"必须成立，且该次读有**条目上限 + truncated 标记**，
  不得因单目录海量条目（如 `deps` 88 万）撞 IPC 2MB 红线（红线 4）。
- **R8（用户级排除 · D2）**：提供 VS Code `files.watcherExclude` 式的**用户配置面**，作为 manifest
  的显式输入（否则无 `.gitignore` 的仓库仍全监听）；未配置时默认 = gitignore + 硬噪声。
  仍禁止语言特定的硬编码目录名黑名单。

## 约束

- **不得破坏 `git-domain.md §14`**：缩小监听集合前，逐派生值证明其依赖仍在监听集合内；
  唯一例外按 R6 显式记录。
- **平台差异只落 `src/platform/`**（红线 10）；通用模块禁止平铺 `#[cfg]`。
- **不改 git 语义 / 快照版本契约**（push/pull、`version_floors`、前端 version gate 不动）。
- **不做语言特定硬编码目录名黑名单**：`gitignore.rs` 既有测试明确要求 `dist/build/out/coverage`
  等真实源码目录不得被误伤（`git_ignore_filter_does_not_hide_non_ignored_source_dirs`）。
- 行为兼容优先：除 R1/R4 明确修复的事件面外，不改变既有可观察语义。

## Out of Scope

- 不重整 git status 生产者模型（push/pull 双生产者、心跳、`poke_status_worker_and_wait`）。
- 不改为"只监听已展开目录"的整树订阅模型（属更激进的上界方案，另议）。
- 不处理 `target/` 体积本身（`cargo clean` / `[profile]` / Spotlight 排除属周边，可另开任务）。
- 不做 Windows 后端的深度改造（仅定义能力位与降级路径）。

## Acceptance Criteria

- [ ] **AC1**：给定被 gitignore 忽略的目录（夹具由 `tempdir()` 派生，红线 13），
      对其内部的写入**不产生**任何 `file-changed` / `file-tree-changed` 事件（各平台一致）。
- [ ] **AC2**：ignored 目录**自身的创建/删除**仍能被感知并反映为灰节点的更新。
- [ ] **AC3**：存在**能力位**单一决策点（`src/platform/` 下），且策略枚举不再混杂
      "后端能力缺失的兜底"；有直测覆盖"能排除 / 不能排除"两条降级路径。
- [ ] **AC4**：caps 溢出时的行为是**粗化**（有断言证明不再扩大注册/不再全树刷新）。
- [ ] **AC5**：`ignore` 的打开文件不 live-refresh 被写入 spec（`.trellis/spec/backend/`）。
- [ ] **AC6**：展开含海量条目的 ignored 目录时，单次读取的返回有界并带 truncated 语义
      （测试断言不超上限）。
- [ ] **AC7**：全量质量门禁通过（`pnpm check`：lint_fe / lint_rust / test_fe / test_rust / test_host）。

## Decisions（已定案 · 2026-10-09）

| # | 决策 | 结论 |
| --- | --- | --- |
| D0 | 任务结构 | **单任务内的工作流**，不新建 Trellis 子任务目录（便于管理） |
| D1 | ignored 的**已打开文件** | **接受现状：不做额外订阅**（按 R6 写入 spec） |
| D2 | 用户级 exclude | **纳入**：VS Code `files.watcherExclude` 式（见 R8） |
| D3 | 子任务目录 | **不创建**（同 D0；由 `task.json.subtasks` + `implement.md` 管理） |

## Notes

- 权威证据与代码事实：`research/current-watcher-architecture.md`、
  `research/macos-watch-backends.md`、`research/raw-perf-evidence.md`。
- 相关 spec：`.trellis/spec/backend/git-domain.md`（§12 身份 / §14 新鲜度契约）。
