# 实施计划：监听边界与成本模型（单任务 + 工作流）

> **任务结构（D0/D3）**：不新建 Trellis 子任务目录。所有交付物作为本任务内的
> **工作流（workstream）** 管理：名字登记在 `task.json.subtasks`，顺序/验证/回滚写在本文件。
> 每项可独立验收、独立 revert。

## 工作流地图与顺序

```
本任务 10-09-watcher-boundary-cost-model
  ├─ W0 watch-manifest-contract      纯重构底座（行为不变）      ← 先做
  ├─ W1 ignored-structure-events     结构事件收敛（跨平台）      ← W0 后
  ├─ W4 user-watcher-exclude         用户级 watcherExclude（D2） ← W0 后
  ├─ W3 tree-read-entry-cap          读层有界 + 按需展开         ← 独立，可并行/最先
  └─ W2 macos-fsevent-exclusion      macOS 物理排除（A 落地）    ← W0 + W1 后
```

### 排期理由

- **W3 最先可并行**：与监听无关，纯读层有界（红线 4），收益独立。
- **W0 是共同底座**：先把边界抽成 `WatchManifest` + 能力位 `WatchBackend`，**行为不变**（纯重构），
  W1/W2/W4 都基于它，避免各自造一套边界。
- **W1 先于 W2**：W1 让"ignored 子树不成为结构事件目标"先在回调层成立（跨平台、无后端依赖）；
  W2 再把同一语义下沉到注册层。两步都做时，W1 在 `RecursiveFilterOnly` 降级态下仍是兜底。
- **W4 独立于 W1**：用户排除只扩充 manifest 输入，不改事件分类，可与 W1 并行。
- **W2 最后**：成本最高、涉及平台后端替换，且必须避免同时改"事件语义"与"注册语义"。

## 各工作流

### W0 `watch-manifest-contract`（纯重构，行为不变）

- 交付物：`common/file/watcher/manifest.rs`（`WatchManifest`）+ `src/platform/watch_backend.rs`
  （`WatchBackend` 能力枚举，替换 `watch_selectively(): bool`）；`registration/strategy.rs` 只消费能力枚举。
- 验收：既有 watcher 测试全绿且**行为等价**（事件面、注册面均不变）。
- 文件面：`manifest.rs`(新) / `platform/watch_backend.rs`(新) / `registration/strategy.rs` /
  `platform/watch_strategy/`（退役或转调）。
- 回滚：独立 revert，无行为影响。

### W1 `ignored-structure-events`

- 交付物：`classify.rs::structure_event_paths` 感知 gitignore —— 位于 ignored 子树**内部**的路径
  **丢弃**（不产生任何 tree 失效目标）；仅保留 **ignored 根自身**的出现/消失/改名边界事件
  （灰节点更新由父目录捕获）。
- 验收（AC1/AC2/AC4 的事件面）：ignored 目录内 Create/Remove → **不产生** `file-tree-changed`；
  ignored 根创建/删除 → 由父目录捕获并更新灰节点；`>64 dirs` 不再被 `target/**` 触发。
- 文件面：`manager/classify.rs`（+ 纯函数测试）。
- 回滚：独立 revert（事件语义单一改动）。

### W4 `user-watcher-exclude`（D2 · VS Code 式）

- 交付物：用户级 `watcherExclude` 配置面（glob）→ **并入唯一忽略判定** `GitIgnoreFilter`
  （见 `design.md §3.5`），使注册层 / 事件分类 / 读层三处一致生效；默认空 = 只 gitignore + 硬噪声。
  前后端配置读写与 UI 入口。
- 约束：**禁止语言特定硬编码目录名黑名单**（`git_ignore_filter_does_not_hide_*` 是钉子）。
- 验收：配置后对应子树零监听（含结构事件、读层剪枝）；未配置时行为与 W1 后一致。
- 文件面：配置类型/命令/前端设置面板 + `GitIgnoreFilter` 判定层 + 两处生产构造点。
- 回滚：配置面可整体关闭（默认空），不影响其他工作流。
- **已知残留（复核登记）**：① 用户排除在**构造期冻结**，`reload()` 不重读 config —— 编辑配置需
  重挂载/重启生效；② ~~`read_watcher_excludes` 与 `StorageManager` 各自构造 config 路径~~ → **已收敛**
  （复核跟进）：读取下沉到 `StorageManager::watcher_excludes`（配置路径唯一事实源），
  `WatcherManager` 注入 provider、读层接收 `user_excludes` 参数，watcher 域不感知 config 路径、
  测试可用 `StorageManager::with_dir` 隔离；③ `!` 白名单可反向覆盖 gitignore 忽略（与“单一判定”自洽，
  有直测）；④ **非 git 项目不生效**：`core.rs` 的 `gitignore_filter` 以 `git_repo` 为门控、读层
  `resolve_gitignore_filter` 亦对非仓库返回 `None`，故 `watcherExclude` 在无 `.git` 的目录上静默无效
  （R8 字面在非 git 项目不成立；设计动机是「无 `.gitignore` 的**仓库**」，git 仓库已覆盖）。如需覆盖纯
  目录项目，另开任务（需给 manifest/读层另造过滤输入）。

### W3 `tree-read-entry-cap`（独立）

- 交付物：`read_dir_recursive` 单层**条目上限 + truncated 语义**；ignored 目录"点击再加载"保持可用
  （现状 `dirPath ? 1 : DEFAULT_TREE_DEPTH`），但返回有界，不撞 IPC 2MB（红线 4）。
- 验收（AC6）：展开含海量条目目录时返回条目数 ≤ 上限且带 truncated 标记（测试断言）。
- 文件面：`common/file/services/tree_read.rs` + 前端 loader/节点类型。
- 回滚：独立 revert。
- **已知残留（复核登记）**：① `MAX_DIR_ENTRIES` 是**每层**上限，不是全局上界 —— depth≥2 的
  宽树理论上总量仍可 >2MB（R7 口径的「点击展开单目录」= depth=1 已覆盖）；② 嵌套截断只向顶层传播，
  被 seed 进缓存的子目录拿不到 `is_truncated`（数据有界，仅提示缺失）；③ WSL/Remote 分支未施加
  单层上限（代码内已显式标注）。三项均不在 W3 设计口径内，如需全局上界另议。

### W2 `macos-fsevent-exclusion`（A 落地）

- 交付物：macOS 用 `FSEventStreamSetExclusionPaths` 物理排除 `ignored_roots`（+ 用户排除）；
  形态优先级 A2（自写 `notify::Watcher`）> A3（上游 PR）> A1（本地 patch/vendor notify）。
- 前置：W0（能力位、manifest）、W1（收敛语义）。
- 验收（AC1/AC3）：ignored 目录内写入零事件；能力位单一决策点有"能排除/不能排除"两条降级直测；
  `degraded` 可观测；带**运行时回退开关**（退回 `RecursiveFilterOnly`）。
- 文件面：`src/platform/watch_backend/`（macOS 实现）+ `registration/strategy.rs`。
- 回滚：运行时开关 + 独立 revert。
- **可选性（重要）**：W0/W1/W3/W4 已在**行为层**实现「ignored 内部零事件」；W2 是**成本优化**
  （让内核不再向本流投递），可拆为独立 spike，**不阻塞本任务收口**。落地草案（A2：自写 macOS
  `notify::Watcher` + `FSEventStreamSetExclusionPaths`，绑定已具备）见
  `research/macos-fsevent-exclusion-implementation.md`。
- **落地结果（2026-10-09）**：A2 已实现于 `src/platform/watch_backend/`
  （`mod.rs` + `platform_watcher.rs` + `macos.rs`）；移植 notify 6.1.1 `fsevent.rs`（CC0-1.0，
  保留版权来源注释），仅在 `FSEventStreamStart` 前插入 exclusion 设置。
  `manager/core.rs::watch` 把 `WatchManifest::compute` 上移到建 watcher 之前，
  `ignored_roots → build_exclusion_paths → create_file_watcher`。
- **两条实测硬事实**：① exclusion 有 **8 目录硬上限**（Apple 头文件）→ 保序截断，超出部分
  由 W1 回调过滤兜底；② 排除只过滤被排除目录**内部**，目录**自身** create/remove 仍投递
  → AC2 不受影响（`excluded_root_boundary_event_still_arrives` 钉住）。
- **回退开关**：环境变量 `NEEKO_DISABLE_FSEVENT_EXCLUSION`（另含非 macOS / 空排除 / 构造失败
  三条回退，均退回 `RecursiveFilterOnly`）。
- **已知残留**：① ~~`.gitignore` / 用户排除在挂载后变更时 macOS 不重建 exclusion 流~~ → **已修**
  （2026-10-09 复核跟进）：`ReloadAll` 现在对能物理排除的后端重组 exclusion 流
  （`maintenance.rs` → `PlatformWatcher::set_exclusion_paths` → `MacFseventWatcher::update_exclusions`）。
  未做的是**频繁变更合并**（每次规则变化重建一次流；`FSEventStreamSetExclusionPaths` 只接受 8 个
  目录的成本仍是 ②）。用户排除仍在构造期冻结（config 变更需重挂载，见 W4 残留）；
  ② exclusion 集合有 8 目录硬上限（超出部分由 W1 回调兜底，仅成本）；
  ③ `WatchManifest::compute` 现在在 macOS 挂载时也执行一次可见树遍历（换取物理排除）；
  `RecursiveFilterOnly`（Windows）不计算，行为与 W2 前一致。

## 验证命令（每个工作流收尾至少跑）

```bash
# 定向
cargo test --manifest-path src-tauri/Cargo.toml watcher
# W2 后端测试路径是 platform::watch_backend，**不**被上面的 `watcher` 过滤器命中（须单独跑）
cargo test --manifest-path src-tauri/Cargo.toml --lib watch_backend
cargo test --manifest-path src-tauri/Cargo.toml --lib
# 全量质量门禁（定义单点：package.json 的 check）
pnpm check
```

## Review Gates（对齐本仓库红线）

| Gate | 内容 |
| --- | --- |
| 红线 10 | 平台差异只落 `src/platform/`（`watch_backend`），通用模块禁止平铺 `#[cfg]` |
| 红线 4 | 读层返回有界（W3）；事件 payload 有界（现有 caps 语义保留） |
| 红线 13 | 测试夹具路径一律 `tempdir()` 派生 |
| `§14` | 缩小监听集合前后逐派生值核对依赖（含 D1 例外） |
| 覆盖 | 纯函数 100%（manifest / 结构事件收敛 / 能力位 dispatch） |

## Rollback Points

- 工作流互不交叠文件面：W0 在 `manifest.rs`+`platform/`；W1 在 `classify.rs`；
  W4 在配置面 + manifest 输入；W3 在 `tree_read.rs` + 前端 loader；W2 在 `platform/`+`registration/`。
- W2 上线须带**运行时回退开关**（退回 `RecursiveFilterOnly`），保证 excl 后端出问题时不影响可用性。

## 验收清单（本任务收口）

> 工作流「done」是「实现+复核完成」，不等于任务收口；最终验收以 AC1–AC7 + R8 为准。

- [x] AC1 ignored 目录内写入 → 零事件（各平台；W1 纯函数 + macOS 真实 FSEvents 差分用例）
- [x] AC2 ignored 根出现/消失 → 灰节点更新（边界事件保留；删除后仍保留）
- [x] AC3 能力位单一决策点 + 降级路径有直测（能力位枚举 + 工厂三分支 + `set_exclusion_paths`）
- [ ] AC4 caps 溢出不扩大观察面 —— **未按字面实现**；已作为**显式例外**收口
      （`SelectiveRegistration` 触顶仍递归，§14 下界优先；见 design §4 复核补记 + `degrade_recursive` 注释）
- [x] AC5 已打开 ignored 文件不 live-refresh 写入 spec（D1/D5）
- [x] AC6 展开海量条目目录返回有界 + truncated（每层上限 2000 + 前后端贯穿）
- [x] AC7 `pnpm check` 全绿（2026-10-09 全量实跑：23 条门禁 / 0 违规，`test_rust` 341s / `test_fe` / `test_host` / `lint_fe` / `lint_rust` 均绿）
- [x] R8 用户级 `watcherExclude` 落地（D2）
- [x] 工作流完成状态更新到 `task.json.subtasks` / 本清单

## 工作流状态

> **复核跟进（2026-10-09，`neeko-check`）**：已修复 review 违规项 ——
> ① `platform/watch_backend/mod.rs` 拆为薄壳（`types`/`factory`/`platform_watcher` + 每平台
> `linux|macos|windows.rs` 能力位 + `macos_fsevent.rs` 实现，红线 9/10）；
> ② macOS 撤销忽略的正确性缺口：`ReloadAll` 重建 exclusion 流（§14 下端界）；
> ③ AC5 写入 `.trellis/spec/backend/git-domain.md` §14（R6 例外 + W2 重建落点）；
> ④ AC4/R5 与代码的冲突已作为显式例外登记（design §4 + `degrade_recursive` 注释）；
> ⑤ `read_watcher_excludes` 从 watcher 域移出 → `StorageManager::watcher_excludes` +
> `WatcherManager` 注入 provider（依赖倒置，配置路径单源、测试可隔离）；
> ⑥ 能力位 `can_exclude_subtrees` / `registers_selectively` 成为真实决策点；
> ⑦ `EditorPanel` 回归展示组件（props 下传，不再直连 `useAppContext`）；
> ⑧ 补 `customThemeVars.test.ts`。
>
> **第二轮独立复核跟进（2026-10-09）**：无 Block；补齐证据面与文档面 ——
> ① `create_file_watcher` 拆出可测内核 `create_file_watcher_with_disabled`，补三条降级直测
> （空集合/非 macOS→Native、env 开关→Native、有集合→MacExclusion），闭合 AC3 的「工厂回退」证据；
> ② 修文档漂移：`registration/mod.rs` 的 macOS「无法按目录排除」旧述、`WatcherExcludeSection.tsx`
> 的 `useAppContext` 旧述；③ §14 补登第二个已知例外（W2 物理排除 + `!` 重包含）；
> ④ W4 残留更新（config 路径已单源、测试隔离已解决；新增「非 git 项目 `watcherExclude` 不生效」边界）；
> ⑤ `structure_event_paths` 去重由 `Vec::contains` 改 `HashSet` 去 O(n²)。
>
> **第三轮独立复核跟进（2026-10-09）**：无 Block；修红线 3 与证据面 ——
> ① `file/commands.rs::read_dir_tree` 的 `watcher_excludes()`（读 config.json）由 async 体内同步调
> 改为 `spawn_blocking`，且仅 `ExecTarget::Local` 才读（远程 ignored 走远程 `ls-files`）——
> 闭合红线 3；② 补 `PlatformWatcher::set_exclusion_paths` 两条直测（`Native` no-op / macOS 委托）；
> ③ `manager/core.rs` 仅在 `watch_backend().can_exclude_subtrees()` 时计算 `exclusions`，
> 去掉 Linux/Windows 上的无谓整树派生。
>
> **接受残留（第三轮复核登记，勿再当缺口）**：① `registration/maintenance.rs` 的 `ReloadAll` 胶水
> （`can_exclude_subtrees` → `compute` → `set_exclusion_paths` 三行）无端到端测试 —— 两端点
> （`build_exclusion_paths`、`PlatformWatcher::set_exclusion_paths`）已直测，仅中间编排未覆盖；
> ② `ReloadAll` 以全局 `watch_backend()` 而非活变体为准，env 降级为 `Native` 时会多做一次
> manifest 遍历 + no-op `set_exclusion_paths`（仅成本，正确性不受影响）；
> ③ `fsevent_exclusion_disabled()` 单行 env 读取本身无测试（可测内核 `_with_disabled` 已覆盖语义）；
> ④ W4「构造期冻结」在 linked worktree（根不匹配）下读层会用活 provider 现建过滤器，与 watcher
> 冻结态存在瞬态差异（过监听，安全）。
>
> **第四轮跟进（2026-10-09，主会话自检）**：把上述残留逐个收口 ——
> ① `ReloadAll` 的重建编排抽为命名函数 `refresh_exclusions`（活变体判定 → manifest 派生 → set），
> 补 3 条直测（Native no-op / 无 filter no-op / macOS 活变体重建）；维护线程本体只剩一行调度；
> ② 新增 `PlatformWatcher::supports_subtree_exclusion()`（**活变体**检查）替代全局 `watch_backend()`，
> env 降级时跳过无收益重建；③ 补公开工厂 env 读取路径直测（`_when_env_unset`），闭合 N-4；
> ④ `design.md §3.5` 登记 worktree 瞬态过监听；⑤ 护栏 `check_workspace_identity` 的 notify 适配豁免
> 从「整个 `platform/watch_backend/`」**收窄到两个文件**（`platform_watcher.rs` + `macos_fsevent.rs`），
> 并补一条「同目录其它文件仍受约束」的反例测试。
> 至此上一轮登记的 Warning/Nit 均已闭合，无新残留。
>
> **第五轮跟进（2026-10-09，主会话自检）**：闭合第四轮独立复核发现的未登记成本缺口 ——
> 运行期**新出现**的 ignored 根（如首次 `cargo build` 前的 `target/`）在挂载时尚未存在、未被收进
> exclusion，其内部 churn 仍会投递。`registration/maintenance.rs` 的 `AddDir` 分支现在：若新增目录
> 是 ignored 根且后端真在物理排除（`added_ignored_root_needs_rebuild`），补一次 `refresh_exclusions`，
> 使物理排除跟上运行期边界；可见目录的平凡新增不触发（避免每次新建目录都全树遍历）。补 4 条直测
> （macOS 忽略根→需重建 / 可见目录→不需 / Native→不需 / 无 filter→不需）。
> 另：`implement.md` 验收清单改为与工作流状态一致（“工作流 done ≠ 任务收口”）。

| 工作流 | 状态 |
| --- | --- |
| W0 watch-manifest-contract | **done**（implement+check 通过；行为等价） |
| W1 ignored-structure-events | **done**（内部丢弃/边界保留；check 另修 add_dir 忽略守卫） |
| W4 user-watcher-exclude | **done**（并入 `GitIgnoreFilter` + 配置面 + 设置 UI；复核通过） |
| W3 tree-read-entry-cap | **done**（每层上限 2000 + truncated 贯穿前后端；复核通过） |
| W2 macos-fsevent-exclusion | **done**（A2 落地：移植 notify FSEvents 后端 + exclusion；真实 FSEvents 差分用例通过；带运行时回退开关） |
