# 设计：监听边界与成本模型（三层契约）

> 本设计把「ignored 子树不该被监听」从一个**具体修复**上升为**结构契约**。
> 现状事实见 `research/current-watcher-architecture.md`；后端可行性见
> `research/macos-watch-backends.md`；成本证据见 `research/raw-perf-evidence.md`。

## 0. 结论摘要（TL;DR）

- 现状：`git-domain.md §14` 只规定了**下界**（监听集合 ⊇ 依赖集合），方案用**最大化过近似**
  满足它 → macOS 整树监听 + 回调过滤，成本无上界。
- 本设计补**上界**：`监听集合 ⊆ 可见集合 ∪ 边界存在性`；并把「边界」做成**可物理实现**的一等实体。
- 三层：**L1 watch manifest（定义）→ L2 平台能力位（物理实现）→ L3 消费侧粗失效（使用）**。
- macOS 的唯一正解是 **FSEvents + `FSEventStreamSetExclusionPaths`**（VS Code 同路）；
  kqueue 语义更纯但 fd ∝ 条目数、无文件名、需重扫，**不构成"更根本"**。

## 1. 根因（第一性原理）

**表象**：Rust 项目里 `target/**` 被监听、构建 churn 打到前端、`fseventsd` 100% CPU。

**根因（逐层）**：

1. **正确性公理是单边的**：`监听 ⊇ 依赖` 只禁止"漏"，不禁止"过"；工程上满足下界最省事的办法是
   把集合开到最大。
2. **成本边界被当成内容语义**：`gitignore` 回答"git 是否跟踪/展示"，监听边界要回答"我拒绝观察哪些子树"。
   两者在 Linux 恰好重合（都逐目录剪枝），在 macOS 必然分叉 —— 于是"边界"退化为"事后过滤"。
3. **平台差异被建模成等价策略**：`WatchStrategy::{Selective, Recursive}` 被当作同层策略，
   实际是"后端支持剪枝"与"后端不支持、只能兜底"。能力差异被伪装成了选择。
4. **渲染与订阅耦合**：为让 ignored 目录显示为灰节点，结构事件**故意违反 gitignore**
   （`structure_event_paths`）→ 泄漏路径成立。
5. **降级方向反了**：`MAX_WATCH_DIRS` 溢出 → `degrade_recursive()`（**观察面变大**）；
   `TREE_CHANGED_MAX_DIRS` 溢出 → 全树刷新。过载应**粗化**，不应扩大。

## 2. 不变量（本任务要建立并锁死的性质）

> **I1（下界，沿用 §14）**：监听集合 ∪ 触发重算集合 ⊇ 该派生值的依赖集合。
> **I2（上界，本任务新增）**：监听集合 ⊆ 可见目录集合 ∪ {ignored 根的存在性}。
> ↓ 合起来：**ignored 子树的内部变化不产生任何监听输入**。
> **I3（边界可物理实现）**：manifest 的每个条目都必须能被当前后端"真正排除或省略"；
> 做不到的后端必须显式进入降级态（可观测），而不是假装边界存在。
> **I4（结构事件面向可见节点）**：结构事件只以"可见目录集合的成员变化"为目标；
> ignored 根的边界变化由其**父目录**（可见）表达。
> **I5（降级只粗化）**：任何 cap 溢出，只允许降低精度（根级失效 / 更大的失效粒度），
> 不允许扩大观察面或整树刷新（`degrade_recursive` 仅在"递归 + 物理排除"能力可用时允许）。

判据：
- 「ignored 目录里写入」会产生事件吗？→ **不会**（全平台，含 macOS）。
- 「ignored 根出现/消失」会更新灰节点吗？→ **会**（父目录监听）。
- 后端能不能真的排除？→ 能力位单一决策点可答；不能 → 显式降级标记。

## 3. L1：watch manifest（边界一等化）

```rust
// 建议落点：common/file/watcher/manifest.rs（新）
pub struct WatchManifest {
    root: PathBuf,
    /// 需注册/订阅的可见目录（含 root）
    visible_dirs: Vec<PathBuf>,
    /// 被剪枝的顶层 ignored 子树（macOS exclusion / 灰节点语义共用）
    ignored_roots: Vec<PathBuf>,
    /// 是否因裁剪或上限而降级（I3 的可观测位）
    degraded: bool,
}
```

生成规则（顺序即优先级）：
1. `.git` 元数据：恒排除（既有 `is_hard_noise_path`）；
2. **可见性剪枝**：沿可见树遍历，`should_ignore_own()` 命中即**不进入**，并把命中目录收进
   `ignored_roots`（复用 `compute_watch_dirs` 的语义，不新造匹配逻辑）；
3. **用户级 exclude**（D2 已定：VS Code `files.watcherExclude` 式），在 gitignore 之外；
4. `visible_dirs` 有界（沿用 `MAX_WATCH_DIRS`），但**超限时不再丢语义**（见 §4 降级）。

> **否定规则（`!`）**天然由 `ignore` crate 处理：剪枝发生在**第一个被忽略目录**，这正是 git 语义
> （被忽略目录下的 `!` 无法重新包含）。禁止自造黑名单（`git_ignore_filter_does_not_hide_*` 是钉子）。

### 3.5 用户级排除（W4 · D2）：并入唯一忽略判定

用户排除**不是**「manifest 的又一个输入层」那么简单 —— 它必须进入**唯一忽略判定**
`GitIgnoreFilter`，否则注册层（manifest）、事件分类（`relevant_event_paths` /
`structure_event_paths`）、读层剪枝会各自为政，重演 W1 刚修的「结构事件泄漏 ignored 子树」。

- **配置面**：`AppConfig.watcherExclude: string[]`（`~/.neeko/config.json`），
  VS Code `files.watcherExclude` 式 glob；默认空 = 只 gitignore + 硬噪声（行为不变）。
- **判定层**：`GitIgnoreFilter` 增一个 root 锚定的用户排除 matcher（`GitignoreBuilder`，
  gitignore 方言支持 `**` 与 `!`），`should_ignore` / `should_ignore_own` 在既有分层裁定前先查它。
  **`!` 白名单按 git 分层语义双向**（`Whitelist→不忽略`，可反向覆盖 gitignore 层）——这是
  “单一忽略判定” 自洽的代价，已由直测钉住。
- **构造点**：`GitIgnoreFilter::new(root)` 保持「仅 gitignore」（测试用）；生产模式由**配置域**
  读取（`StorageManager::watcher_excludes`，配置路径唯一事实源），经**组合根注入**：watcher
  侧用 `WatcherManager::with_watcher_excludes` provider，读层 `resolve_gitignore_filter` 接收
  `user_excludes: &[String]`。watcher 域**不感知** `~/.neeko/config.json` 路径（依赖倒置）。
- **生效时机**：**构造期读取并冻结**模式（MVP）；`reload()` 复用已缓存模式、**不重读 config**；
  因此编辑 `watcherExclude` 后需 **重挂载 / 过滤器重建 / 重启** 才生效（`tree_read` 的
  `local_gitignore_cache` 同理）。「config 变更 → 即时失效/重建」另议，不在 W4。
  特例：linked worktree（读层根与 watcher 根不匹配）会用**活 provider** 现建读层过滤器，
  与 watcher 的冻结态存在**瞬态差异** —— 偏差方向是**过监听**（更安全），不影响正确性。
- **已知限制（`!` 白名单 vs 物理排除）**：`!reinclude` 只在**过滤 / 读层**生效；macOS 物理排除
  按**顶层 ignored 根**整体置入 exclusion，无法在排除子树内部反向放行（`FSEventStreamSetExclusionPaths`
  无否定语义）。因此对被物理排除的子树内部的 `!reinclude` 路径，macOS 不投递事件（读层展示仍正确、
  重挂载后恢复）。属 W2 的已知边界，不影响零监听主目标。
- **禁止**语言特定硬编码目录名黑名单（`git_ignore_filter_does_not_hide_*` 是钉子）。

## 4. L2：平台能力位（替换 `watch_selectively(): bool`）

```rust
// src/platform/watch_backend.rs（新；红线 10：平台差异只落 src/platform/）
pub enum WatchBackend {
    /// 可对子树做物理排除（macOS FSEvents + exclusion paths）
    SubtreeExclusion,
    /// 只按目录注册（Linux inotify / macOS kqueue 逐目录）
    SelectiveRegistration,
    /// 只能整树订阅 + 回调过滤（当前 macOS notify）
    RecursiveFilterOnly,
}
pub const fn watch_backend() -> WatchBackend;
```

- 现有 `watch_selectively()` 升维为 `WatchBackend`；`registration/strategy.rs` 只消费能力枚举。
- **降级矩阵**：

| 能力 | 注册方式 | ignored 子树 | 超 `MAX_WATCH_DIRS` 时 |
| --- | --- | --- | --- |
| `SubtreeExclusion` | 根递归 + exclusion 列表 | 物理不投递 | 仍递归 + exclusion（**不扩大观察面**）|
| `SelectiveRegistration` | 逐可见目录 NonRecursive | 不注册 | → 递归 + 回调过滤（+ 标记 degraded）|
| `RecursiveFilterOnly` | 根递归 | 回调丢弃（**降级态**）| 无变化；记 degraded 指标 |

> **R5 的显式例外（复核补记 · 2026-10-09）**：`SelectiveRegistration` 触顶时仍走
> `degrade_recursive`。若拒绝递归，超出上限的**可见**目录将无人监听 —— 那是无界陈旧，直接违反
> §14 **下端界**。两难中下界是正确性契约、优先于成本上界；该路径只在可见目录数触顶时可达，
> 且 W1 已使 ignored churn 不再触发它，`degraded` + warn 日志使其可观测。`SubtreeExclusion`
> 不经过此路径（永远递归 + exclusion），天然满足 R5。

- `degraded` 必须可观测（日志/metrics），避免"边界存在但没人知道它没生效"。

## 5. L3：消费侧（粗失效 + 按需读）

1. **结构事件收敛**（`classify.rs`）：
   `structure_event_paths` 里，位于 ignored 子树**内部**的路径 → **丢弃**（监听层不订阅 ignored 内部）；
   只有 **ignored 根自身**的出现/消失/改名保留（灰节点更新，由父目录捕获）。
   → 消除 `target/**` churn，保留「ignored 根出现/消失」语义。
   （注：不能"塌缩到 ignored 根" —— 下游 `push_parent_dir` 取父目录会产出 `dirs=[""]` 的根 reload，
   每个构建窗口一次，违反 AC1。）
2. **caps 粗化**：`TREE_CHANGED_MAX_DIRS` 溢出不改变语义（已是"更大粒度"），但要保证它**不再被
   ignored churn 触发**（由 §5.1 消除触发器）。
3. **按需读**（读层）：ignored 目录点击展开已可用（`dirPath ? 1 : DEFAULT_TREE_DEPTH`）；本任务只补
   **条目上限 + truncated 语义**（R7 / 红线 4）。

## 6. macOS 路线抉择

| 路线 | 判定 |
| --- | --- |
| **A. FSEvents + exclusion paths** | **推荐**。O(1) 订阅、事件带文件名、物理排除；`fsevent-sys 4.1.0` 已暴露 API；VS Code 同路 |
| B. kqueue | 语义纯但 fd ∝ 条目数、**无文件名**、需重扫、非默认后端；不采纳为默认 |
| C. 不 watch 共同祖先 | 嵌套 ignored 无法覆盖；仅作 A 的补充 |
| D. 回调过滤（现状） | 仅作 `RecursiveFilterOnly` 降级态保留 |

A 的落地形态（工作流 `macos-fsevent-exclusion` 再细化）——
**落地草案与所需绑定实证见 `research/macos-fsevent-exclusion-implementation.md`**：
- **A1**：本地 patch/vendor `notify`，在 `Config`/watch 接受 exclusion 集合（改动面最小）；
- **A2**：自写实现 `notify::Watcher`（`fsevent-sys` + runloop + `CFArray`），Neeko 侧按平台选后端；
- **A3**：向上游 notify 提 PR（长期）。

约束：exclusion 集合应在流启动前设置；边界变化（`.gitignore`/`node_modules` 变化）意味着**重建流** ——
频率远低于逐目录注册，可接受，但必须处理。

**落地实测（2026-10-09，W2）**：① `FSEventStreamSetExclusionPaths` 有 **8 个目录硬上限**
（Apple 头文件），实现保序截断到 8，超出部分由 W1 回调过滤兜底（成本优化不完整、正确性不受影响）；
② 排除只过滤被排除目录**内部**变化，目录**自身**的 create/remove 仍投递 —— 正好满足 R1/R4/AC2；
③ 排除后端带运行时回退开关 `NEEKO_DISABLE_FSEVENT_EXCLUSION`（退回 `RecursiveFilterOnly`）。

## 7. 决策点（已定案 · 2026-10-09）

| # | 决策 | 结论 |
| --- | --- | --- |
| D0 | 任务结构 | **单任务 + 工作流**（不建子任务目录）；见 `implement.md` |
| D1 | ignored 的**已打开文件**是否 live-refresh | **接受不刷新**并写入 spec（既有行为；如需刷新另开“打开文件按路径订阅”）|
| D2 | 是否引入用户级 `watcherExclude` | **纳入**（VS Code 式；见 R8）。隔离在 `src/platform/` 与 manifest 输入层 |
| D3 | manifest 的 ignored 剪枝是否也作用于**读层** | 读层已剪枝；保持“读层展示灰节点、监听层不订阅” |
| D4 | macOS 是否立刻换后端 | 先落 L1/L3（低风险），再在工作流 `macos-fsevent-exclusion` 做 A |
| D5 | 已打开 ignored 文件的语义 | 写入 `.trellis/spec/backend/`（AC5），避免以后当 bug 反复调查 |

## 8. 迁移与回滚

- **M1（纯重构）**：抽出 `WatchManifest` + `WatchBackend`，**行为不变**；测试锁定等价性。
- **M2（行为修复）**：`structure_event_paths` 收敛 ignored → 影响事件面；用事件级测试锁定。
- **M3（后端）**：macOS exclusion 后端上线，`RecursiveFilterOnly` 作运行时回退开关。
- 回滚点：M2/M3 各自独立，可单独 revert；M1 无行为影响可随时保留。

## 9. 测试策略（TDD）

- **纯函数**：manifest 生成（剪枝/`!` 语义/上限）、`structure_event_paths` 收敛、能力位 dispatch 分支。
- **集成（tempdir，红线 13）**：ignored 目录内写入 → **断言零事件**；ignored 根创建/删除 → 断言灰节点更新。
  夹具路径一律由 `tempdir()` 派生（`.trellis/spec/unit-test/real-source-determinism.md`）。
- **回归钉子**：现有 `lifecycle_tests` 依赖真实 FSEvents + 8s 超时（`raw-perf-evidence.md §2`）——
  改造后须避免"以真实事件投递时序为判据"（否则 CI 抖动）。必要时改为注入式事件源。
- **护栏（建议）**：`check_watch_boundary` —— 禁止在 macOS 路径上对 ignored 子树做逐事件处理；
  或校验"能力位单一决策点"。

## 10. 风险

| 风险 | 缓解 |
| --- | --- |
| notify patch 的维护成本（fork 偏差） | 优先 A2（自写后端，不动依赖）或 A3（上游）；A1 最后选 |
| exclusion 重建流的抖动 | 仅在边界变化时重建；合并短时间内的多次变更 |
| `§14` 例外（已打开 ignored 文件）被当成 bug 反复调查 | 写入 spec（D1） |
| 改造触发 watcher 集成测试抖动 | 先消除"真实时序依赖"，再改注册层 |
| 行为面扩大（用户级 exclude 的语义） | 后置为独立子任务（D2） |
