# C4 Implement — 热集合 reconcile + 删除补偿机制

> 前置：读 `src/AGENTS.md`（硬指令：动手改 `src/**` 前必须读）与父任务 `design.md §1.0/§1.5/§2`。
> 关键约束：**删除优先**。任何「保留 `requestedIntent` 但加注释/开关」的写法直接驳回。

## 0. 勘察（开工第一步）

- [ ] `rg -n "useActiveWorkspaceSync|useActivateWorkspace|ACTIVATION_RETRY|requestedIntent" src`
      —— 确认唯一调用链：`useAppShellData` → `useActiveWorkspaceSync` → `useActivateWorkspace` → `gitApi.activateWorkspace`。
- [ ] `rg -n "set_active_workspace|set_visible_workspaces" src src-tauri/src`
      —— 前者待删（前端调用点 + 命令 + `lib.rs` 注册）；后者已就位。
- [ ] `rg -n "clearActiveWorkspace|invalidateStatus" src/features/project src/app`
      —— 确认「删除 worktree → 回落主仓」这条路径**已存在**（R2.2 的替代触发者），不需要新建。
- [ ] `rg -n "aheadBehind" src` —— 确认 C1 之后 `useAheadBehindSync` 是否已被快照覆盖；
      若快照已携带 ahead/behind，本任务可顺带删掉这条「冷启动种子」的第二写者（登记在偏差里）。

## 1. 后端：`set_visible_workspaces` 改为 reconcile（R1.3）

- [ ] **Red**（`git/services/status.rs`）：`visible_set_releases_units_outside_it`
      —— 先挂载 A、B（两次 `activate_many`），再 `activate_many(&[A])`，断言
      `watched_units()` 只剩 A，且 B 的登记表数据**仍在**（`snapshot(B)` 非 None）。
- [ ] **Green**：`activate_many` 在 `ensure_mounted` 之后，对**已挂载但不在本轮集合里**的单元调用
      `manager.unwatch`（走既有的释放路径，保留数据）。实现要点：
      - 集合的**判定**必须在**一次临界区内**与挂载一起完成（否则「先算差集再释放」中间有人挂上就误杀）；
        建议在 `WatcherManager` 加 `reconcile_mounted(units) -> (created, released)`，锁内完成差集。
      - 远端单元（`supports_push_producer == false`）**不参与**差集：它们从不挂载，
        也不该因为「不在集合里」去触发任何释放。
- [ ] **Red**：`reconcile_keeps_a_unit_that_is_still_in_the_set`（同集合重复调用 → 无 created、无 released）。
- [ ] 日志：`[Watcher] reconcile mounted N (new: X, released: Y)`，替换 `ensure mounted` 那条
      （R4.2 的可观测面；AC1 靠它判读）。

## 2. 前端：`useVisibleWorkspaces`（R1）

- [ ] **Red**（`renderHook` + mock invoke）：同一集合两次渲染只发一次 invoke；
      集合变化发一次；`pending` 不写 store；`failed` 只调 `logFrontendError`。
- [ ] **Green**：新建 `src/app/hooks/useVisibleWorkspaces.ts`：
      ```ts
      const hot = useHotWorkspaceSessions();      // 派生点唯一：当前 tab 所在单元（+ 可见停靠面板）
      const signature = hot.map(s => s.key).sort().join('\n');
      useEffect(() => { void syncVisible(hot) }, [signature]);
      ```
      依赖数组只用**字符串签名**，不用 `hot` 对象（`hook-guidelines.md` 常见错误 5）。
- [ ] `gitApi.setVisibleWorkspaces(workspaces)`：`invoke<WorkspaceActivationEntry[]>('set_visible_workspaces', { workspaces })`。
- [ ] 删除 `useActiveWorkspaceSync.ts` 与 `useActivateWorkspace.ts`；`useAppShellData` 改调
      `useVisibleWorkspaces()`。
- [ ] 删除 `gitApi.activateWorkspace` 与后端 `set_active_workspace`（命令 + `lib.rs` 注册 + 任何测试引用）。

## 3. 删除补偿机制（R2）

- [ ] `useAppShellData.ts:133-145` 整个 effect 删除（含依赖数组）。
      **删除前确认** R2.2 的替代路径存在：`useWorktreeListActions.performRemove` 已调
      `clearActiveWorkspace`；`useSessionBootstrap` 的清单校验是一次性读（不是 render-time 比较）。
      若发现「worktree 在别处被删而本地清单不知情」的场景，**不要**在 render 里补判据 ——
      改为在清单读取失败时回落（一次性），并在此处登记。
- [ ] `rg 'requestedIntent|inflightIntent|reportedGiveUp|retryTick|ACTIVATION_RETRY' src` → 空（AC5）。
- [ ] `rg 'set_active_workspace' src` → 空（AC6）。

## 4. 护栏（R4）

- [ ] 新检查 `tools/guards/checks/check_frontend_resource_mirror.py`：
      - 判据 A：`src/**` 生产代码出现 `requestedIntent` / `inflightMount` / `mountTicket` 类标识符 ⇒ 违规；
      - 判据 B：`refreshWorkspaceStatus(` / `getWorkspaceStatus(` 的调用行若同时位于
        `useEffect` 之外且不在事件/回调上下文中 ⇒ 违规（实现上按「文件内是否位于 `useEffect(` 的
        括号范围内」这一保守判据，允许 `const cb = useCallback(() => …)` 形态）。
      - 配套正反用例（框架强制）；接入 `pnpm lint` 与 CI（`gates.json` 若需新增门，同步接线）。
- [ ] `ledger/invariants.json` 增一条红线 17 的 enforcement 记录。

## 5. 验证

```bash
pnpm vitest related src/app/hooks/useVisibleWorkspaces.ts
cargo test --lib git::services::status        # reconcile 的三条用例
cargo clippy --all-targets -- -D warnings
pnpm check:quick                              # 收尾一次（含新护栏）
```

- [ ] AC1/AC2 靠日志与 `watched_units()` 断言（`cargo test`）+ 手测日志复核。
- [ ] 手测：访问 6 个 workspace → `~/.neeko/neeko.log` 里同一时刻在册单元 ≤2。

## 回滚点

- 后端 reconcile 与前端发送端是同一语义的两半，**必须同一个 commit**（只上后端会让前端
  不知道「集合=真值」，只上前端会让后端不释放）。
- 若需要临时回退：把 `reconcile_mounted` 的释放段关掉即回到 C2 行为（`ensure_mounted`），
  前端无需改。**不要**用环境变量长期保留双行为。

## 风险

| 风险 | 缓解 |
| --- | --- |
| reconcile 误杀「刚被别的面板挂上的单元」 | 差集在**一次临界区**内与挂载一起算（R1.3 实现要点） |
| 释放冷单元导致切回时短暂空态 | 释放保留登记表数据（C1）⇒ 切回读得到旧值 + `dirty` 触发重算，不空转 |
| 删除回落主仓 effect 后「worktree 消失」无人处理 | R2.2 的替代路径勘察（第 3 步第一条）必须先确认再删 |
| 集合签名依赖 key 顺序不稳定 | 排序后 join；签名比较是唯一判据（R1.4） |

---

## 实施结果（已完成）

### 落地清单

| 步 | 落点 | 状态 |
| --- | --- | --- |
| A `reconcile_mounted(units, keep)`：差集 + 挂载 + 释放同一临界区 | `manager/core.rs` | ✅ |
| A `activate_many` 改为声明式（`keep` = 本批解析成功的 git 单元，含远端） | `git/services/status.rs` | ✅ |
| A 删 `ensure_mounted`（只增不减的入口零调用方，留下即第二个挂载入口） | `manager/core.rs` | ✅ |
| B `useVisibleWorkspaces`（签名去重 + 三态载荷 + 空集合声明） | `app/hooks/useVisibleWorkspaces.ts` | ✅ |
| B 删 `useActiveWorkspaceSync` / `useActivateWorkspace` / `gitApi.activateWorkspace` | — | ✅ |
| B 删后端 `set_active_workspace` + `lib.rs` 注册 + 单元素 `activate()` | `git/commands/query.rs`、`lib.rs`、`status.rs` | ✅ |
| C 删 render-time 回落主仓 effect，改为两个一次性触发者 | `useAppShellData.ts` / `useRefreshGitInfo` / `useSessionBootstrap` | ✅ |
| C 删 `retryBudget.ts`（重试环机制本体，零消费者） | `shared/utils/retryBudget.ts` | ✅ |
| D `check_frontend_resource_mirror.py`（红线 17 机器判据，13 条正反用例） | `tools/guards/checks/` | ✅ |
| D `invariants.json` 增 `frontend-no-resource-state-mirror` | `tools/guards/ledger/invariants.json` | ✅ |
| Spec 同步 | `git-domain.md §12`、`concurrency-guidelines.md` 契约 3、`state-management.md` 场景 6、`hook-guidelines.md` 编排 Hook 表 | ✅ |

### 变异验证（Red 复核，三条）

| 变异 | 变红的用例 |
| --- | --- |
| `reconcile_mounted` 的释放循环改 no-op | `visible_set_releases_units_outside_it` |
| effect 依赖改成每次新建的数组（`hook-guidelines` 常见错误 5 的形态） | 「集合不变不重发」、「切到非 git 项目」 |
| 护栏判据自身 | 探针文件 3 处命中（2 个影子标识符 + 1 处渲染期调用），删除后 0 违规 |

### 偏差（如实登记）

1. **删了 `ensure_mounted` 而非保留**：reconcile 成为唯一挂载入口后，它零生产调用方；
   留着就是第二个入口（与 `mount-entry-singularity` 冲突）。连带把 4 条 manager 生命周期用例
   的判据从「两个单元都常驻」翻转为「挂载集合恒等于声明」—— 这正是 R1.3 的语义变更。
2. **`retryBudget.ts` 一并删除**：它是被删重试环的机制本体，删掉 hook 后零消费者。
3. **R2.2 的替代路径有一处真实缺口**：「worktree 在别处被删而本地清单不知情」原由 render-time
   effect 兜住。现改为两个**一次性**触发：用户动作（`clearActiveWorkspace`）与清单读取
   （`useRefreshGitInfo` → `fallbackToMainIfWorkspaceGone`）。**没有**在 render 里补判据。
4. **红线 16/17 未登记进 `AGENTS.md` 台账** —— 见下方「未完成项」。
5. `useAheadBehindSync` 保留：↑N 徽标的冷启动种子，仍有消费者，且写的是同一把 `WorkspaceKey`
   （不是第二身份）。删除属独立议题。
6. `pending` 不再触发任何重试（prd R1.5 明确要求）。残留风险：某单元挂载成功但 worker 始终不推送时，
   Changes 面板停在 `Loading changes…` 直到下一次读动作（聚焦 hint / 手动刷新 / `git-changed`）。

### 验证记录（主会话独立复跑）

- `rg 'requestedIntent|ACTIVATION_RETRY|reportedGiveUp|retryTick' src --glob '!*.md'` → **空**（AC5）。
  不加 `--glob` 时 `src/AGENTS.md` 会命中：红线 17 的正文要点名反例，而护栏判据 A 只扫
  `src/**/*.ts(x)` —— 两者口径必须一致，否则「判据与记录不符」。
- `rg 'set_active_workspace' src` → **空**（AC6）；后端仅剩两处注释说明「已删除」。
- 三个待删文件确认不存在（`useActiveWorkspaceSync.ts` / `useActivateWorkspace.ts` / `retryBudget.ts`）。
- `cargo test --lib` → **2589 passed / 0 failed / 9 ignored**（同前：临时把别人未提交的
  `migrations.rs` 改回 13，跑完按 sha256 `bd32ae0e…128c6` 还原）。
- `cargo clippy --all-targets -- -D warnings` → 0 诊断。
- `pnpm check:quick` → **36 条护栏全通过**（新增 `check_frontend_resource_mirror`），
  改动文件的前端单测绿。

### 红线 16 / 17 已登记（收尾补齐）

机制原先只有 guard + `invariants.json`，编号未进任何 `AGENTS.md` 索引表 —— 任务归档后规则会失去落点。
已按「选项 1」补齐，且**没有**提高 cap（`agents_md_routing.json` 的 ratchet 未动）：

| 项 | 改动 | 结果 |
| --- | --- | --- |
| 根 `AGENTS.md` | 表格增第 16 / 17 行；压缩两处与规则无关的冗余散文（红线区引言的「支柱」考古、已知问题的 Vite 措辞），共省 164 B | 16,306 B / cap 16,384 B（余 78 B） |
| `src-tauri/AGENTS.md` | 新增正文 **16. 资源稀缺不得进数据契约** | 13,571 B |
| `src/AGENTS.md` | 新增正文 **17. 禁止影子副本** | 8,599 B |
| `agents_md_routing.json` | `signatures` 增 `16` / `17`（机读台账，17 条逐条在列） | `check_agents_md_size` exit 0 |
| `invariants.json` | `frontend-no-resource-state-mirror` → `red_line: 17`；新增 `resource-scarcity-stays-out-of-the-data-contract` → `red_line: 16` | `check_invariant_enforcement` exit 0 |

`pair_cap` 复核：root + src-tauri = 29,877 / 30,720 B（余 843 B）；root + src = 24,905 B。

### 复核（`trellis-check`）发现并修掉的两条真缺陷

| # | 缺陷 | 为什么是真缺陷 | 修法 |
| --- | --- | --- | --- |
| F1 | 删掉 render-time 回落 effect 后，**R2.2 的替代触发者在它要处理的场景里跑不到** | `useRefreshGitInfo` 的回落位于 `Promise.all([refreshGitInfo, refreshWorkspaceStatus])` 之后，而这两个命令都按**当前单元**寻址 —— 单元已被删时必然 reject，`.then` 永不执行。恰是「外部 `git worktree remove`」这唯一场景。 | 把回落接到 `useGitStatusEventsSync.refreshUnitBranchInfo` 写过清单之后（`git-changed` 通常带**共享 gitdir 的活单元** key，因此它能成功拿到「已不含被删 worktree」的新清单）。新增回归用例并 Red 验证。 |
| F2 | 声明无顺序保证：**旧声明可晚于新声明落地**，以它的 `keep` 释放刚挂上的单元 | 每次 `invoke` 各自 spawn，后端 reconcile 前还 `await` 地址解析 / 仓库校验（远端是 SSH/WSL 往返，百 ms～秒级）。并发声明因此可以乱序，之后没有视图变化就不再收敛（重试环已删）。 | 发送端串行链 + 「非最新签名即跳过」（顺序 + 合并）。这是**顺序句柄**，不记录后端状态 ⇒ 不触红线 17。新增「上一条未落地不发下一条」用例并 Red 验证。 |

**F3（护栏假阴性，已修）**：判据 B 的「普通函数放行」原先无条件授予区间，
`hook` 里包一层具名函数再渲染期调用会被整段放行（实测探针漏判）。现要求该声明**不在**任何
hook / 组件本体区间内才授予；新增 1 条用例，变异验证（去掉包含判据）会红。

**F4（判据与记录不符，已修）**：AC5 原写 `rg ... src` 为空，但 `src/AGENTS.md` 的红线 17 正文
必须点名反例 ⇒ 必然命中。已把 AC5 与验证记录统一为「生产代码 `src/**/*.ts(x)`，与护栏判据 A 同口径」。

**F5（非本任务改动，提交排除）**：工作区里别人未提交的 `common/db/migrations.rs`
（`LATEST_VERSION=18` 而迁移链只到 12）会让 DB 夹具报 `unknown migration version: 13`。
两个任务全程只在跑测试时临时改回 13、跑完按 sha256 还原；提交**不含**该文件。
