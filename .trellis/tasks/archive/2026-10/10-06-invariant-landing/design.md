# T2 Design：三条不变量落层

## R1 依赖方向 → 结构 + guard

### 接口变化

```rust
// src-tauri/src/git/services/status.rs
use crate::common::file::watcher::WatcherEventSink;      // 删掉 AppHandleSink

pub async fn activate(
    state: &AppStateWrapper,
    sink: Arc<dyn WatcherEventSink>,                     // 替换 &tauri::AppHandle
    repo: &RepoRef,
) -> Result<GitStatusSnapshot, AppError>
```

```rust
// src-tauri/src/git/commands/query.rs（红线 6：命令层只做校验 + 适配接线）
let sink: Arc<dyn WatcherEventSink> = Arc::new(AppHandleSink::new(app));
crate::git::services::status::activate(&state, sink, &repo).await
```

**为什么实例注入而非工厂**：`activate` 一次只挂一套资源（`mount_only` 内部只 `watch` 一次），
无「多次 / 懒构造」需求 → YAGNI。工厂仅在将来「一次激活挂多单元」时再引入。

### 测试支撑抽取（DRY）

`AppStateWrapper` 隔离夹具现 3 份（`dap/testing.rs`、`browser/url_validator.rs`、
`dap/adapter/java/backend.rs`）→ 抽到共享 `#[cfg(test)]` 模块：

```rust
// 共享测试支撑（cfg(test)）
pub fn isolated_state(tmp: &tempfile::TempDir) -> AppStateWrapper
pub fn plain_project_state(tmp: &tempfile::TempDir) -> (AppStateWrapper, String)
```

`dap/testing.rs` 改 `pub use` re-export，dap 调用点零改动。

### 服务层编排测试（`git/services/status.rs` 的 `#[cfg(test)]`）

用 `isolated_state` + `tempfile` 造真实 git 仓（`git2::Repository::init`），注入
`CollectingSink`（`sink.rs::test_support`），断言：

1. `activate` 可被驱动（旧签名必红：收 `&AppHandle` 根本调不起来）。
2. 挂载后 `CollectingSink` 收到 `git-status-snapshot`。
3. 先挂主仓、再挂 worktree → 旧单元被释放（编排层 D-B，此前只在 manager 层测）。
4. 远端分支（WSL/SSH）仍由 `supports_push_producer` 纯函数钉住；`compute_and_record` 依赖
   真实 transport，**诚实不测**（在 implement 注明）。

### 新 guard

`check_service_no_delivery_dep.py`：扫 `src-tauri/src/git/services/**/*.rs`，禁止
`tauri::` / `AppHandle` / `AppHandleSink`。命中即违规，无台账。

## R2 status 单一读取口 → 信息隐藏 + guard

### selector 补齐

```ts
export function selectStatuses(state: ProjectStoreState): Record<string, RepoStatus>
export function selectHasStatus(state: ProjectStoreState, repoKey: RepoKey | string): boolean
```

### 迁移表（7 处）

| 位置 | 迁移后 |
| --- | --- |
| `GitControlPanelWrapper.tsx:56` | `selectEntries(s, repoKey)?.length` |
| `FilesPanelWrapper.tsx:43` | `selectEntries(s, repoKey)` |
| `WorktreeList.tsx:61` | `selectStatuses(s)`（hooks 不能在循环里按 key 订阅，整表 selector 最简） |
| `ProjectGitSection.tsx:44` | `selectEntries(s, mainRepoKey)` |
| `GitCommitPanel.tsx:63` | `selectStatus(s, repoKey)` |
| `useGitStatusEventsSync.ts:77` | `selectStatus(store, snap.repo_key)?.branch`（**不用** `selectBranch`：后者把缺失折成 `''`，会改语义） |
| `useSessionBootstrap.ts:74` | `!selectHasStatus(getState(), mainKey)` |

### 诚实声明：为什么不做类型级隐藏

zustand 的 `useProjectStore` 类型即完整 state，无法按消费端收窄；把 map 藏进闭包会破坏
devtools / 持久化并显著加复杂度（KISS）。机制选择 = **guard 判据 + 注释同步**，而非类型体操。

### guard 判据 7（加进 `check_repo_unit_identity`）

```python
PROJECT_STATUSES_RE = re.compile(r"\.statuses\b|[{,]\s*statuses\b")
PROJECT_STATUSES_ALLOWLIST = ("src/shared/store/projectStore.ts",)
```

注释行已被 `_code_lines` 清空、`__tests__` 已跳过、全仓无第二个 `statuses` 字段 → 无假阳性。

## R3 组件规模预算 → 确定性 ratchet

### 现状

`src/**/components/**` 42 个、`src/**/hooks/**` 17 个文件 >300 行 → 全量硬门禁会立刻红。

### ratchet 设计

`check_component_size.py` + `ledger/component_size.json`：

```jsonc
{
  "max_lines": 300,
  "baseline": { "src/features/skill/components/ProjectSkillContent.tsx": 1448, ... }
}
```

判据：
- 扫描 `src/**/components/**/*.{ts,tsx}` 与 `src/**/hooks/**/*.{ts,tsx}`，跳过 `__tests__` / `.test.`；
- 文件 ∉ baseline 且 `lines > max_lines` → VIOLATION（**新债止步**）；
- 文件 ∈ baseline 且 `lines > baseline[path]` → VIOLATION（**只许缩小**）；
- `ledger/component_size.json` 缺失/不可解析 → broken；
- `scanned == 0` → 框架拦（空转）；
- baseline 中已删除的文件 → note（可见，允许清理）。

基线由脚本一次性生成（命令写进 guard 模块 docstring 与 spec），**禁手抄**。

## 台账追加（T2 收尾）

`ledger/invariants.json` 追加三条：

| id | tier | 落点 |
| --- | --- | --- |
| `service-no-delivery-dependency` | structure | guard `check_service_no_delivery_dep` + test |
| `status-single-read-path` | structure | guard `check_repo_unit_identity` + test |
| `component-size-budget` | guard | guard `check_component_size` + test |
