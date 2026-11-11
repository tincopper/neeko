# 执行计划：合并 multi-agent 到 feat-team

## 0. 机制与顺序

**形态**：一个 merge commit（父提交 = feat-team 顶端 + `685cd26d`）。merge 中途无法分段提交，
所以可审性靠三件事保证：① 本文件的分组清单逐条打勾；② 每个 pass 结束 `git status` 只增不减；
③ 收尾用 `git diff --first-parent HEAD^ HEAD` 复核净效果。

**为什么按 pass 而不是按文件**：46 个冲突里有 8 个携带新特性接线（B/C 组），
它们必须等 A 组的「主线形态」先落定，否则补回增量时没有可对齐的模板。
逆向（先补后落）会把 theirs 的旧形状当成模板。

**工作树**：`~/.neeko/worktrees/feat-team`（分支 `feat-team`）。探测用的 `/tmp/merge-probe`
在 Pass 0 清除 —— 它只是用来产出冲突清单的。

---

## Pass 0 · 前置（一次性）

- [ ] `git status` 干净；`python3 ./.trellis/scripts/task.py current` 指向本任务
- [ ] `git branch backup/feat-team-pre-merge HEAD`（AC7）
- [ ] `git worktree remove --force /tmp/merge-probe`（清掉探测树）
- [ ] 记录基线：`echo $(git rev-parse HEAD) $(git rev-parse multi-agent)` → 写进本文档末尾
- [ ] `git merge --no-commit --no-ff multi-agent`（立刻可 `--abort`）
- [ ] 确认冲突清单与设计文档一致：`git diff --name-only --diff-filter=U | wc -l` = 46

## Pass 1 · A 组：主线形态落定（逐字取 ours）

14 个文件，命令形态：`git checkout --ours -- <file> && git add <file>`

- [ ] `src-tauri/src/agent/hooks/boot.rs`
- [ ] `src-tauri/src/agent/hooks/ingest/dispatch.rs`
- [ ] `src-tauri/src/agent/hooks/ingest/handlers.rs` ⚠️ 取 ours **前**先扫 multi-agent 的 +252 行，
      确认除 `ExtraConsumer` / `compose_consumers` / `run_guarded` 外没有别的团队接线（有则记下，Pass 3 移植）
- [ ] `src-tauri/src/conversation/text.rs`
- [ ] `src-tauri/src/conversation/normalize.rs`
- [ ] `src-tauri/src/conversation/adapters/{claude_code,codebuddy,codex,gemini,grok,omp,pi,qoder,reasonix}.rs`（9 个）
- [ ] `src/shared/store/dockStore.ts`
- [ ] `src/shared/store/__tests__/dockStore.test.ts`

`ProjectGroup.tsx` / `useFileEditorState.ts` 虽然多数内容取 ours，但有增量要判断 → 归 Pass 2。

## Pass 2 · B 组：在主线形状上补 theirs 的增量

每文件的操作是：`checkout --ours` → 打开 theirs 的 diff（`git diff :1:<f> :3:<f>`）→ 只把新特性需要的块
按主线写法加回去 → `git add`。

- [ ] `src-tauri/src/app/mod.rs`：`pub mod session_lifecycle;` + `mod team_executor;` + `mod team_notifier;`
- [ ] `src-tauri/src/app/boot.rs`：`hook_sinks` 追加 `Arc::new(crate::agent::team::deliver::observe)`（D4）
- [ ] `src-tauri/src/common/db/migrations.rs`：按 D5 加 `TEAM_MIGRATION_FIRST/LAST` + `migrate_step` 分支 +
      扩展 `fresh_database_migrates_to_latest` 断言（版本 21 + team/work_items 表存在）
- [ ] `src-tauri/src/common/testing.rs`：`abs_fixture`（ours）与 `strip_line_comments`/`comment_start`（theirs）并存
- [ ] `src/shared/events.ts`：追加 `AGENT_TEAM_EVENT`；work_items 若有多端事件同样追加（对账 Rust `events.rs`）
- [ ] `src/shared/dock/types.ts`：按主线 union 形状追加 `team` / `tasks` 视图键
- [ ] `src/shared/dock/panelMeta.ts`：按主线字段追加两条 panel 元数据
- [ ] `src/app/dock/registry.ts`：追加 `team` / `tasks` 的 component 条目与 lazy wrapper 导入
- [ ] `src/app/dock/__tests__/registry.test.ts`：跟随 registry 增补断言（不改既有断言，只加新条目）
- [ ] `src/shared/types/tab.ts`：ours + `TeamBoardTabData` / `TeamTaskTabData`；**不含** `existingSessionId`
- [ ] `src/shared/store/editorStore.ts`：ours + 新 kind 的透传（若新 kind 需要）；terminal 分支保持主线
- [ ] `.eslintrc.cjs`：主线目录清单 + `agent-team` / `work-items`
- [ ] `src/shared/components/ProjectGroup.tsx`：ours + 「Open Tasks」按钮（`HeaderActionButton` + `ListChecksIcon`，
      位置按 multi-agent 的注释意图：Git 菜单之前）
- [ ] `src/features/editor/hooks/useFileEditorState.ts`：ours（`createTaskTerminal` 返回 boolean，D3 附注的反例）

## Pass 3 · C 组：新特性入口适配主线 API

- [ ] `src-tauri/src/terminal/{commands,manager,router,mod}.rs`：ours + `extra_env`（D2）
      - `TerminalLaunch` 增字段（默认空）→ `router::create_session` 透传 → `manager` 的三端分支 → `services` 的 PTY env
      - WSL/SSH：忽略不报错（team 成员会话只在 Local）
      - 新用例：`extra_env` 注入到 Local 子进程；WSL/SSH 分支不注入
- [ ] `src-tauri/src/app/team_executor.rs`（新文件，非冲突）：`SessionSpec{...}` → `TerminalLaunch` +
      `TerminalRegistration{workspace,cwd,agent_id}`；`extra_env` 走新字段
- [ ] `src/app/components/AppCenter.tsx`：ours + `tasks` 中心视图分支（D8：与 library 分支同构，不引入 CenterViewFrame）
- [ ] `src/app/components/__tests__/AppCenter.test.tsx`：ours + tasks 分支用例
- [ ] `src/app/components/__tests__/DockBarButton.test.tsx`：ours + 新 entry 用例（如相关）
- [ ] `src/features/conversation/index.ts`：ours + theirs 的 `conversationIdOf`/`parseConversationId` 导出（若新代码需要）
- [ ] `src/features/terminal/api/taskTerminal.ts`：ours，并确认 multi-agent 侧已无调用方（`grep` 归零）
- [ ] `src/features/terminal/components/terminalCache.ts`：ours
- [ ] `src/features/terminal/hooks/useTerminalTabs.ts`：ours + team 打开入口改走 `attachSessionId` / `sessionTabFactory`（D7）
- [ ] `src/features/terminal/strategies/index.ts`：ours（multi-agent 的 `takeoverUnsupported` 不进来）
- [ ] multi-agent 新增文件里引用 `existingSessionId` / `openExistingTerminalTab` 的地方（`TeamPanelWrapper.tsx`、
      `TerminalTakeover.test.tsx`、`useTerminalTabs.takeover.test.ts`）改写成 attach 语义

## Pass 4 · 自动合并的 30 个文件审计

逐个：`git diff HEAD -- <file>`（HEAD = feat-team 顶端）→ 判断保留/回退 → 在下方表格打勾。
**默认回退**，保留必须写理由。

| 文件 | 决定 | 理由 |
| --- | --- | --- |
| `src-tauri/src/lib.rs` | 保留 | 两侧都加命令，合并结果即所需（AC6 对账） |
| `src-tauri/src/agent/mod.rs` | 保留 | `pub mod team;` 是新特性入口 |
| `src-tauri/src/app_state.rs` | 待定 | `team_manager` 注入是否与主线 `AppStateWrapper` 形状兼容 |
| `src-tauri/src/common/mod.rs` | 待定 | `pub mod text;`（D3 保留则留） |
| `src-tauri/src/conversation/manager.rs` | 待定 | 主线有 title/缓存改动，multi-agent 的日志/接口改动需逐块看 |
| `src-tauri/src/agent/hooks/ingest/event.rs` | 待定 | 事件字段是否被 team 依赖 |
| `src-tauri/src/agent/hooks/ingest/notify.rs` | 待定 | 同上 |
| `src-tauri/src/agent/hooks/templates/{neeko-report.mjs,neeko-omp-status.ts,neeko-pi-status.ts,tests.rs}` | 默认回退 | 主线 hook 模板是 shim 唯一来源（红线 5 同族），除非 team 需要新字段 |
| `src-tauri/src/git/services/commit/prompt.rs` | **回退** | D3：multi-agent 改为 `common::text`，会改主线 git 域行为 |
| `src/app/hooks/{buildAppShellValues.ts,useAppShellData.ts}` + 测试 | 待定 | team store 接线入口 |
| `src/features/library/components/LibraryPanel.tsx` | **回退** | multi-agent 的 `CenterViewFrame` 改造不动主线视图 |
| `src/features/project/components/ProjectItem.tsx` | 待定 | 是否只是加任务入口动作 |
| `src/features/editor/components/TabItemLeading.tsx` | 待定 | 新 tab kind 的图标分流 |
| `src/features/terminal/api/__tests__/taskTerminal.test.ts` | 待定 | 跟随 `taskTerminal.ts` 的决定（D3 反例：保 boolean） |
| `src/features/terminal/components/TerminalViewBase.tsx` | 待定 | attach 路径是主线事实，multi-agent 改动需逐块看 |
| `src/features/terminal/strategies/{factory,types}.ts` | 待定 | `existingSessionId` 类型必须拿掉 |
| `src/shared/store/__tests__/editorStore.test.ts` | 待定 | 跟随 editorStore |
| `vitest.config.ts` | 待定 | multi-agent 加了 DOM-free node 环境配置（`9486b8e8`），若新测试需要则保留 |
| `.trellis/spec/**` 4 个 md、`.trellis/workspace/tincopper/journal-8.md` | 合并保留 | 文档 union，无行为影响 |

## Pass 5 · 编译与测试循环

- [ ] `cd src-tauri && cargo check --all-targets` → 逐个修（只改 multi-agent 侧）
- [ ] `cargo test --lib common::db agent::team work_items terminal conversation agent::hooks`（按需分域跑）
- [ ] `pnpm check:quick`（仓库规定：收尾只跑这一次）
- [ ] AC5 四面结构核对：
      - `grep -n "pub(crate) async fn create_session" -A6 src-tauri/src/terminal/router.rs`
      - `grep -n "placements\|barItems" src/shared/store/dockStore.ts`
      - `grep -rn "HookSink" src-tauri/src/agent/hooks/ingest/dispatch.rs`
      - `grep -n "strip_ansi" src-tauri/src/conversation/text.rs`
- [ ] 冲突标记归零：`grep -rn '^<<<<<<<\|^>>>>>>>' --include=*.rs --include=*.ts --include=*.tsx src src-tauri tools` 空

## Pass 6 · 收尾

- [ ] `git add -A && git commit`（merge commit；消息格式
      `merge(branch): bring multi-agent into feat-team with mainline as the baseline`，
      正文列出三件事：保留了什么主线结构、移植了哪些新特性、适配了哪些调用点）
- [ ] `python3 ./.trellis/scripts/task.py set-meta merge.parents "<feat-team-top> <685cd26d>"`
- [ ] spec 同步：`.trellis/spec/backend/` 记录 team/work_items 域与 hooks sink 第三条消费者；
      `.trellis/spec/frontend/state-management.md` 记录 team store 与 dock 入口（union 时已带上，核对是否需要修剪）
- [ ] 记录后续任务（不在本任务做）：`strip_ansi` 三处收敛；`existingSessionId` 残留扫描；
      multi-agent 侧 spec 文档与主线 spec 的冲突段落清理

## 验证命令清单

```bash
# 冲突与状态
git diff --name-only --diff-filter=U
grep -rn '^<<<<<<<\|^>>>>>>>' --include=*.rs --include=*.ts --include=*.tsx src src-tauri tools

# Rust
cd src-tauri && cargo check --all-targets
cd src-tauri && cargo test agent::team work_items common::db

# 前端收尾（唯一一次）
pnpm check:quick
```

## 回滚点

| 阶段 | 手段 |
| --- | --- |
| 未提交 | `git merge --abort` |
| 已提交 | `git reset --hard backup/feat-team-pre-merge` |

## 基线记录

- feat-team 顶端：`5c863f60`
- multi-agent 顶端：`685cd26d`
- 分叉点：`d00a4861`
