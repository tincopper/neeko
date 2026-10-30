# 执行计划：历史会话删除

> 需求见 `prd.md`，设计见 `design.md`。TDD：每项先写失败测试（Red）→ 实现（Green）。
> 阶段独立可回滚。

## P1 · 能力面：三态 + 删除单元（Rust，纯函数优先）

- [x] 1.1 `conversation/adapter.rs`：`SessionDeleteSupport` 三态 + trait 默认实现
      （`delete_support() = Unsupported` / `delete_command() = None` / `delete_targets() = [file]`）。
      **Red**：默认值契约测试（新增 adapter 不表态时必须是 Unsupported，而非「恰好可用」）。
- [x] 1.2 各 adapter 表态：
      codex / opencode → `Native` + `delete_command`（`codex delete <uuid>` /
      `opencode session delete <ses_id>`）；pi / claude / qoder → `Storage` 默认单文件；
      grok → `Storage` 且 `delete_targets` = 会话**目录**；reasonix → `Storage` 且
      `delete_targets` = `[<id>.jsonl, <id>.events.jsonl]`；omp → `Storage` 单文件。
      **Red**：`delete_targets` 的边界用例（grok 目录 / reasonix 双文件 / 默认单文件）。
- [x] 1.3 能力自洽护栏：`Native ⇒ delete_command 非空`；`Storage ⇒ targets 非空且全部落在
      `session_root()` 之下`；registry 里每个 adapter 都被覆盖。
- [x] 1.4 `ConversationMeta` 增加 `delete_support`（序列化名 `deleteSupport`），扫描时写入。
- [x] 1.5 验证：`cargo test --lib conversation`。
- **回滚点 A**。

## P2 · 执行：manager + 薄命令（Rust）

- [x] 2.1 `ConversationManager::delete(id)`：
      id → 缓存 meta（无 → `NotFound`，**不触盘**）→ adapter → 路径必须 startswith
      `session_root()` → 按三态执行（`Native` 走 `core::exec::run`；`Storage` 走
      `spawn_blocking` 逐目标删）→ 成功才 `cache.remove` + `scan_cache` 失效该路径。
      **Red（tempdir 夹具，红线 13）**：不存在 id / 路径越界 / Storage 单文件 / Storage 多目标 /
      删后 cache 与 scan_cache 都查不到 / 委派非零退出 → 错误含 stderr 且 cache 未移除。
- [x] 2.2 `conversation/commands.rs`：`delete_conversation(id)` 薄命令（校验 + 调度），
      注册进 `lib.rs`；前端 `conversationApi.deleteConversation(id)`。
- [x] 2.3 验证：`cargo test --lib conversation`；`cargo clippy -D warnings`。
- **回滚点 B**。

## P3 · UI：入口 / 确认 / 使用中保护（前端）

- [x] 3.1 `ConversationItem` 增删除按钮：`meta.deleteSupport !== 'unsupported'` 时出现
      （与 chat 入口一样由容器层派生能力，组件不自发 IPC）。
      **Red**：组件测试（Unsupported 不渲染 / Native 与 Storage 都渲染 / 点击触发回调）。
- [x] 3.2 `ConversationsPanelWrapper`：点击 → 判定是否使用中（tab 里打开 / 活 chat 会话匹配
      `resumeNativeSessionId` 或 `sessionId`）→ 是则 toast「先关闭该会话」并中止；
      否则 `confirmStore` 确认（agent · 标题 · 目标：命令 argv 或路径列表）→ 调用 API →
      成功本地移除行 + 减计数；失败 toast 显示真实原因。
      **Red**：hook/编排测试（使用中阻断 / 确认后调用 / 取消不调用 / 失败不移除）。
- [x] 3.3 会话正文 tab 与 chat tab 类型上的 `conversationId` / `resumeNativeSessionId` 判定
      收敛到一个纯函数（如 `isConversationInUse(tabs, meta)`），单测覆盖。
- [x] 3.4 验证：`pnpm check:quick`（收尾跑一次）。

## 实施记录（与计划的偏差，均为实测/结构逼出来的）

- reasonix 多删 `<id>.jsonl.meta`（design 表原写两个文件）：依据同一判据「删除单元 = 独占且不共享」，
  只删主文件会留下在 CLI 里复活的孤儿。
- `codebuddy` → `Unsupported`（PRD 未列）：其文件头声称可能有 SQLite 权威存储，实现只读 `sessions/*.json`，
  未实测 ⇒ fail-closed。
- `gemini` → `Storage` 单文件：`chats/<session>.json` 一会话一文件、无索引（推断，未实测）。
- 复用 `common::file::services::delete_path`（已有「最深已存在祖先 canonicalize 在根内」+ `spawn_blocking`），
  不新写删除循环。
- 行移除由**面板**（持有 `useConversationList` 的那层）执行，容器返回 `boolean`；wrapper 仍独占
  「使用中判定 / 确认 / IPC」。
- 前端两个编排工具经 `features/conversation/index.ts` 门面导出（app 层不深引 utils）。

## 实测修复（2026-10-30，用户报告「pi 删除会话不成功」）

- 根因：使用中保护把**只读查看器 tab** 当成「占用」。面板里点一行即打开查看器，
  于是「点开 → 删除」100% 被挡（toast: Close this conversation first）—— 功能实际不可用。
  判据错在把「正在看」当成「正在用」。
- 修法：`isConversationInUse` → `isConversationLiveInChat`（只认 agent-chat：那时可能有进程
  正握着会话文件在写）；新增 `conversationViewerTabRefs`（删除成功后按**空间键**关掉查看器 tab，
  跨 workspace/worktree 不漏）。用例改为「查看器不阻断」「chat 会话阻断」。
- 可诊断性：`delete_conversation` 失败时 `log::warn!` 落 `~/.neeko/neeko.log`（原先只有前端 toast，
  后端零痕迹）。
- 回归护栏：`pi::delete_unit_is_the_session_file_inside_the_session_root` —— 用真实路径形态
  （`sessions/--<sanitized-cwd>--/*.jsonl`）钉住所有权判定，并断言共享 `blobs/` 永远过不了判定。

## 实测修复 2（2026-10-30，用户报告「codex 删除失败」）

- CLI 原话：`cannot confirm session deletion without an interactive terminal; rerun with --force
  and a session UUID` ⇒ argv 改为 `codex delete --force <uuid>`；`--force` 要求 UUID，而 codex 的
  `native_session_id` 由 `rollout-<ts>-<uuid>.jsonl` 提取，天然满足。
- 顺手实测 opencode：`opencode session delete <不存在 id>` → 立即 exit 1 + `Session not found: …`，
  **没有交互确认**（不需要 force 旗标）。
- **测试教训（已写进用例注释）**：`assert_eq!(argv, vec![… "--force" …])` 的期望值与实现同形，
  变异「删掉实现那一行」时字面量会被同样的编辑顺手删掉 → 假绿。改为**逐位断言**
  （`len` + 每项），少一个参数就越界 panic，变异必红。

## 实测修复 3（2026-10-30，用户报告「点击删除都没有反应」）

- **根因在确认框，不在删除逻辑**：`ConfirmDialog` 的确认按钮先 `onOpenChange(false)` 再
  `onConfirm()`；store 通道里前者把在途请求按**取消**结算，后者 `resolve(true)` 成空操作 ⇒
  `await confirmAction(...)` 恒 `false`，所有确认门控的动作静默不执行（不止本功能）。
- 修法：确认按钮只调 `onConfirm()`，关闭归调用方；补「真的点了那个按钮」的用例
  （变异：把 `onOpenChange(false)` 加回 → 红）。机制记录进
  `frontend/component-guidelines.md`「确认按钮只调 onConfirm」。
- 顺带：`describeDeleteError` 认识 serde 外部标签 `{Variant:"…"}`（原先每条后端错误都被吞成
  通用文案）；失败原因 + 阶段埋点（`requested/confirmed/invoking/deleted`）写后端日志；
  `useConversationDelete` 不再静默吞异常。

## 收尾

- [x] AC1–AC8 逐条勾验；AC1/AC2（真机 codex / opencode 委派）、AC4（pi blob 未动）为人工验收。
- [x] 同步 spec：`backend/conversation-adapter.md`（三态 + 删除单元表 + 「委派前提 = 同一处存储」）、
      `frontend/api-layer.md`（如需）。
- [x] `pnpm check:quick` + `cargo test --lib` 绿；`add_session.py` 记录；**不主动提交**。
