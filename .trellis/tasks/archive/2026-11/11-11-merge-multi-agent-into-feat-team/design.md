# 技术设计：合并 multi-agent 到 feat-team

## 1. 问题形状

这不是普通 merge。两条线从 `d00a4861` 分叉后**各自重构了同一批地基**，其中三组是「同一件事的两套答案」，
所以 `-X ours` / 「全取 theirs」都会产出语义错误的仓库：

- 全取 ours ⇒ team / work_items 的命令、面板、事件、迁移全部丢失（46 个冲突里有 8 个携带新特性的接线）。
- 全取 theirs ⇒ 主线被改回旧形态（`SessionSpec`、`barItems`、`ExtraConsumer`、`existingSessionId`），
  违反 R1。
- 只有「**先 ours，再按主线惯例补 theirs 的语义增量，最后改 theirs 的调用点**」这个方向能同时满足 R1/R3/R4。

方向判定不靠直觉，靠证据：每个冲突文件都要用 `git log`/`git show` 确认哪侧是主线（feat-team）现行形态。
反例记录 —— 不能假设「theirs 一定旧」：`createTaskTerminal` 的返回值，multi-agent 是
`string | null`（6ae67611），feat-team 是 `boolean`。两者都是「当前」，但**基线是 feat-team ⇒ 保 boolean**，
multi-agent 侧不再有调用方（新特性零引用），所以不需要移植。

## 2. 决策

### D1 基线原则 = ours-first，增量后补

每个冲突文件分两步：① `git checkout --ours` 落 feat-team 原文；② 用 `git diff :1:<file> :3:<file>`
逐块判断 theirs 的改动是不是**新特性所必需**，是则按 feat-team 的写法加回去。判据不是「谁的实现更好」，
而是「不改主线行为的前提下，新特性是否还成立」。

### D2 终端创建：保 `TerminalLaunch`，补环境注入

multi-agent 的团队成员会话靠 `SessionSpec.extra_env` 注入身份/凭证/隔离配置目录
（`app/team_executor.rs:191`，新特性里**唯一**使用 `SessionSpec` 的文件）。
feat-team 的 `TerminalLaunch` 没有 env 字段，且 `ensure_env_injectable` 那套「只许 Local」的守卫在主线不存在。

- 保 `TerminalLaunch` 的字段顺序与语义；**新增** `extra_env: Vec<(String, String)>`（默认空）。
- 链路补齐：`terminal/commands.rs`（IPC 边界保持扁平，新增参数默认空）→ `router.rs` → `manager.rs`
  → `services.rs` 的 PTY 构建处 `cmd.envs(...)`。
- 只对 Local 生效：WSL / SSH 分支忽略该字段（multi-agent 的守卫语义保留为「不注入，不报错」——
  团队成员会话只在 Local 创建，见 `app/team_executor.rs` 的三端判断）。
- `create_session` 的签名只增不改（`env, registration, workspace_root, launch, app_handle` 顺序不动），
  AC5 用签名对账。

### D3 文本域：主线一行不改

`strip_ansi` 在合并后会有三处实现，这是**已知且刻意保留**的状态：

| 位置 | 归属 | 处置 |
| --- | --- | --- |
| `conversation/text.rs` | feat-team 主线 | 逐字取 ours（正则 `\x1B\[[0-9;]*[a-zA-Z]`，`pub(crate)`） |
| `git/services/commit/prompt.rs` 私有 `strip_ansi` | feat-team 主线 | **回退**：multi-agent 已把它改成 `use crate::common::text::strip_ansi`（auto-merge），回退到主线私有实现 |
| `common/text.rs` | multi-agent（新文件） | 保留，只被 `agent/team/sentinel.rs` 引用 |

不采纳 multi-agent 的 `common::text` 搬迁（d7908140）：它把 conversation 与 git 两处收敛到一处，
方向正确，但它会改变主线 git 域的 ANSI 正则（narrow → CSI/OSC 全量），属 R1 禁止的「改乱主线」。
三处收敛列为后续任务（`strip_ansi` 单一落点 + 主线 git 去私有实现），不在本任务做。

### D4 hooks：保 `Vec<HookSink>`，team 消费者只是第三个 sink

feat-team 已把消费者模型做成广播：组合根装配 `Vec<HookSink>`，`via_blocking_pool` 在**一次**
`spawn_blocking` 里按序投递（红线 3 的「一条 hook 一个 worker」由此成立）。
multi-agent 的 `ExtraConsumer` + `compose_consumers` + `run_guarded`（`ingest/handlers.rs` 的
+252 行）解决的是同一个问题，属被主线淘汰的形态。

- `ingest/dispatch.rs` / `ingest/handlers.rs` / `agent/hooks/boot.rs`：逐字取 ours（整块 `ExtraConsumer` 机制不进来）。
- `app/boot.rs`：在 `hook_sinks` 里追加一项 `Arc::new(crate::agent::team::deliver::observe)`。
  multi-agent 的 `deliver::observe(app: &AppHandle, source: &str, event: &HookEvent)` 与
  `HookSink = Arc<dyn Fn(&AppHandle, &str, &HookEvent) + Send + Sync>` **签名天然对齐**，
  直接取函数指针即可，不需要在 `agent::team` 里新增 `sink()` 适配层。
- 顺序：通知 → live-sessions → team（既有两个的顺序不变，team 排在最后：它只读事件 + 写自己的库）。
- 校验：`handlers.rs` 取 ours 前必须先扫一遍 multi-agent 的 +252 行，确认里面没有**除** `ExtraConsumer`
  之外的团队接线（例如新事件分支）；若有，按 sink 模型另作移植。

### D5 迁移：符号常量 + 13..=20 的语义名

feat-team 的形态是可推演常量（`LIBRARY_MIGRATION_LAST` / `CACHE_MIGRATION_STEP` / `LATEST_VERSION = 13`），
`migrate_step` 用 `0..=LAST` + `version if version == X` 守卫。multi-agent 是裸数字 + `LATEST_VERSION = 21`。
两侧**版本号语义一致**（12 = cache v12→v13；multi-agent 的 13..=20 是 team / work_items 的新步骤），
所以不需要重编号，只需要把 multi-agent 的裸数字换成符号常量：

```rust
const CACHE_MIGRATION_STEP: u32 = LIBRARY_MIGRATION_LAST + 1;   // 12
/// v13→v21：团队协调基质与统一任务中心的持久化（逐版本一步）。
const TEAM_MIGRATION_FIRST: u32 = CACHE_MIGRATION_STEP + 1;     // 13
const TEAM_MIGRATION_LAST: u32 = 20;
pub const LATEST_VERSION: u32 = TEAM_MIGRATION_LAST + 1;        // 21
```

`migrate_step` 增加一条 `TEAM_MIGRATION_FIRST..=TEAM_MIGRATION_LAST` 分支，按版本号分派到
`agent::team::store` 或 `work_items::store`（沿用 multi-agent 的 per-version 函数名）。
**必须有用例**：`fresh_database_migrates_to_latest` 断言版本 21 且新表存在（feat-team 已有该用例，扩展它）。

### D6 dock / 注册表 / 事件：主线形状 + 新条目

`dockStore.ts` / `dockStore.test.ts` 逐字取 ours（`placements` 模型）。multi-agent 的 `barItems` 模型不引入。
面板入口按 feat-team 的形状补三条（team 面板、tasks 面板与其 toolbar 入口）：

- `shared/dock/types.ts`：所需 `ViewKey` 成员（team / tasks）按主线 union 形状追加。
- `shared/dock/panelMeta.ts`：条目按主线字段（`defaultSlot` / `defaultOrder` / `host` / `movable`…）写，
  不复用 multi-agent 的字段名。
- `app/dock/registry.ts`：`team` 与 `tasks` 两个 `component` 条目 + 对应 `lazy` wrapper 导入。
- `shared/events.ts`：追加 `AGENT_TEAM_EVENT = 'agent-team://event'`（红线 5：与 Rust 侧
  `agent/team/events.rs` 常量逐字同名）；work_items 若有多端事件同样追加。

### D7 会话接管：`attachSessionId` 而非 `existingSessionId`

主线已用 `attachSessionId`（接回后端已登记的活会话，`sessionTabFactory` 统一铸造 tab）取代了
「tab 直接采纳后端 PTY id」的接管模型，并在 WSL/SSH 上根本不需要 `takeoverUnsupported`。

- `shared/types/tab.ts` 取 ours，追加 `TeamBoardTabData` / `TeamTaskTabData`（新 tab kind，纯增量）。
- `editorStore.ts` 取 ours，`mergeTabData` 的 terminal 分支保持主线实现，追加新 kind 的透传（若新 kind 需要）。
- multi-agent 的 `useTerminalTabs.openExistingTerminalTab` 改为走主线入口（`sessionTabFactory` + `attachSessionId`）；
  `TerminalTakeover.test.tsx` / `useTerminalTabs.takeover.test.ts` 随之改写成 attach 语义（或删除，见 D9 的测试原则）。
- `existingSessionId` 字段整体不进入主线类型。

### D8 中心视图几何

`CenterViewFrame`（multi-agent bf4cad61）在 feat-team 从未存在过，主线用 `CENTER_WRAPPER_CLASS` +
`VisibilityScope` 的裸挂形态。**不改主线的四个既有中心视图**；`tasks` 分支按 library 分支同构挂载
（`VisibilityScope` + 同一 wrapper 类），work_items 内部若自用 `CenterViewFrame` 则自洽，不与主线视图混用。
`AppCenter` 的头注释以 ours 为准（主线的几何归属说明是新事实），不采用 multi-agent 那段
「四个视图都走 CenterViewFrame」的叙述。

### D9 自动合并的 30 个文件：逐个审计，默认回退

两边都改过但 git 自动合并成功的 30 个文件里，multi-agent 的改动被静默拼进来。处理原则：

- **回退**（`git checkout HEAD -- <file>`）当改动是「multi-agent 追赶主线」或改变主线行为
  —— 已知例：`git/services/commit/prompt.rs`（改成 `common::text`）、
  `agent/hooks/ingest/{event,notify}.rs`、`agent/hooks/templates/*`（模板要是有语义差异，取主线）。
- **保留**当改动是纯增量接线且新特性需要 —— 已知例：`lib.rs`（命令注册，两侧都加了，合并结果正确）、
  `agent/mod.rs`（`pub mod team;`）、`app_state.rs`（`team_manager` 注入）、`common/mod.rs`。
- 逐文件在 implement.md 的审计清单里记录「保留 / 回退 / 理由」，禁止整批处理。

## 3. 46 个冲突文件的分组

| 组 | 规则 | 文件 |
| --- | --- | --- |
| **A 逐字取 ours** | 主线结构，theirs 是被淘汰的形态 | `agent/hooks/boot.rs`、`ingest/dispatch.rs`、`ingest/handlers.rs`、conversation 全组 11 个（adapters ×9、`normalize.rs`、`text.rs`）、`shared/store/dockStore.ts`、`__tests__/dockStore.test.ts`、`shared/components/ProjectGroup.tsx`※、`features/editor/hooks/useFileEditorState.ts`※ |
| **B ours + 增量移植** | 先落 ours，再按主线形状补 theirs 的语义 | `app/boot.rs`（team sink）、`app/mod.rs`（`team_executor`/`team_notifier` 声明）、`common/db/migrations.rs`（13..=20）、`common/testing.rs`（`abs_fixture` + `strip_line_comments` 并存）、`shared/events.ts`、`shared/dock/{panelMeta,types}.ts`、`app/dock/registry.ts` + `__tests__/registry.test.ts`、`shared/types/tab.ts`、`shared/store/editorStore.ts`、`.eslintrc.cjs` |
| **C ours + 适配后移植** | theirs 侧是新特性入口，但用了旧 API | `terminal/{commands,manager,router,mod}.rs`（+`extra_env`）、`app/components/AppCenter.tsx`（+tasks 分支）、`__tests__/AppCenter.test.tsx`、`__tests__/DockBarButton.test.tsx`、`features/terminal/{api/taskTerminal.ts,components/terminalCache.ts,hooks/useTerminalTabs.ts,strategies/index.ts}`、`features/conversation/index.ts` |
| **D 文档/账本 union** | 两侧各自追加，按序合并 | `.trellis/spec/frontend/state-management.md`、`.trellis/workspace/tincopper/index.md`、`tools/guards/ledger/invariants.json`、`tools/guards/tests/test_gates.py` |

※ `ProjectGroup.tsx` 的 theirs 增量是「Open Tasks 入口按钮」（`onOpenTasks`），属新特性入口 —— 但它要落在
**主线改过的头部结构**里，所以按 B 组处理：先落 ours，再把按钮按主线的 `HeaderActionButton` 用法插入。

## 4. 验证策略

按「编译 → 单元 → 护栏 → 端到端冒烟」四级，避免在大 diff 上用单一信号判断：

1. `cargo check --all-targets`（`src-tauri/`）—— 捕获所有跨分支 API 漂移。
2. `cargo test` 相关域：`common::db`、`agent::team`、`work_items`、`terminal`、`conversation`、`agent::hooks`。
3. `pnpm check:quick`（eslint / tsc / fmt / clippy / 仓库护栏 + 改动文件相关单测）。
4. 抽样人工核对 AC5 的四个结构断言（签名 / store 形状 / sink 广播 / 文本落点）。

失败的修法边界：编译错误一律改 **multi-agent 侧**（新代码适配主线）；若某处只能通过改主线才能编译，
先回到本文件补一条决策再动手，不允许「顺手」改主线。

## 5. 回滚

- 合并前：`git branch backup/feat-team-pre-merge HEAD`（`backup/multi-agent-pre-main-sync` 已存在，
  对应 multi-agent 顶端 `685cd26d`）。
- 未提交：`git merge --abort`。
- 已提交：`git reset --hard backup/feat-team-pre-merge`。
