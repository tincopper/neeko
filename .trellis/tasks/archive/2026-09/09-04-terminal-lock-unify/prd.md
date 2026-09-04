# terminal 锁统一（sessions/handles/pty 中毒策略收敛）

## Goal

两件事合并一次交付：

1. **审查并优化工作树未提交的 drain 改动**（`drain.rs` 新增 `take_drain/wait_drain/insert_drain/close_and_remove_drain/session_ids` + 两 manager 的接入）：确认提取合理、命名/落点优雅，不合理处在本任务内重构。
2. **收敛剩余的非 drain 锁**（`sessions` / `ssh_handles` / `pty_handles`）的中毒处理策略，对齐已落地的 drain 锁风格（tolerate-and-continue），消除同一文件内 `map_err` / `if let Ok` / `.ok()` 三种风格混用。

## Background

现状（2026-09-04 工作树实测，`rg "\.lock\(\)"`）：

`manager.rs`

- `:188` `pty_handles` → `map_err("Lock poisoned")`（fail-loud，resize 路径）
- `:246` `sessions` → `if let Ok` 静默吞掉（`take_session_handle`，中毒时 session 泄漏）
- `:253` `pty_handles` → `.lock().ok().and_then(remove)`（中毒时返回 None，调用方误判"无此会话"）

`remote.rs`

- `:121` `sessions` → `map_err("Sessions lock poisoned")`
- `:152` `ssh_handles` → `if let Ok` 包裹 `insert`（最严重：中毒时 handle 丢失但会话照常创建，后续 resize/input 空转）
- `:164-169` `drains` 直调 `lock().map_err` 取 drain（drain 统一后的旁路残留）
- `:264` / `:294` / `:298` → `if let Ok` 静默跳过（resize/close 静默失败）

另有一个待确认的语义变更：两边的 `close_all_sessions` 已从枚举 `pty_handles`/`ssh_handles` 改为枚举 `drains`（`session_ids(&drains)`）。正常路径三者同增同删故等价，但一旦失配（如 `:152` 插入失败）会漏扫。本任务需明确 close 枚举源并加单测锁定。

## Requirements

0. **审查工作树 drain 改动**（5 个 helper + 两 manager 接入点），逐项确认或重构，结论写入 `design.md §D0` 后执行：
   - `take_drain` 的空闭包 `take_and_rearm(|| {})` 是否必须走 `take_and_rearm`（而非直接 `take_all`）——涉及 `wake_in_flight` 复位语义；
   - `insert_drain` 内部构造 `SessionDrain::default()` 是否合适（vs 接收外部 `Arc`，考虑单测注入）；
   - `close_and_remove_drain` 是否完整保留先 close 再移除的孤儿泵语义；
   - `session_ids` 用于 `close_all_sessions` 的枚举源变更是否可接受（见 design.md D4）；
   - 注释/命名是否与 `drain.rs` 现有中英混排风格一致、有无冗余。
1. **定一条中毒策略**：建议 tolerate-and-continue + `log_warn`（对齐 drain 风格；终端锁中毒就 fail 整条会话代价太大）。写入 `design.md` 并经确认后执行。
2. **收敛非 drain 锁**：`sessions` / `ssh_handles` / `pty_handles` 的 `if let Ok` + `.ok()` + `map_err` 统一到同一 helper（位置建议 `common/terminal/` 下新建小模块或复用 `drain.rs::lock` 并改名/提升可见性，禁止在 `mod.rs` 写业务逻辑）。
3. **收敛 drain 旁路**：`remote.rs:164-169` 改走共用 helper（`take/wait` 或新增 `get_drain`），生产路径不再直调 `drains.lock()`（测试内的 `.expect("infallible: drains lock")` 保留）。
4. **明确 close 语义**：确认 `close_all_sessions` 枚举源（drains vs handles），二选一并单测锁定；`close_session` 先 close 再移除的顺序保持（孤儿泵黑洞吸收语义不变）。
5. **不改变行为契约**：除中毒路径从"静默/报错"变为"容忍+warn"外，所有正常路径行为不变；`#[tauri::command]` 层保持极薄（只调 manager，不新增命令）。

## Out of Scope

- 不碰 `SessionDrain` 内部逻辑（buffer/push/take/wait 协议本身）；只动查表层 helper 及其调用点。
- 不引入新的跨线程原语（如 RwLock 替换 Mutex）；只做策略收敛，不做并发模型改造。
- 不处理前端代码。

## Acceptance Criteria

- **AC0** drain helper 审查结论逐项落实：`take_drain` 必须走 `take_and_rearm`（附注释说明 wake 复位原因）或给出等价替代证明；`insert_drain` 签名经确认；无冗余注释。
- **AC1** `rg "\.lock\(\).ok\(\)|if let Ok.*\.lock\(\)" src-tauri/src/terminal/manager.rs src-tauri/src/terminal/remote.rs` 在生产路径零命中（测试模块除外）；所有非 drain 锁走同一 helper。
- **AC2** 中毒注入单测：对 `sessions` / `ssh_handles` / `pty_handles` 逐一 poison 后，`take/resize/close` 不 panic、行为符合 design.md 锁定的预期（容忍继续 + warn 日志），覆盖 local + remote 两边。
- **AC3** `close_all_sessions` 枚举源单测锁定：drains/handles 失配注入时行为符合 design.md 决策。
- **AC4** 质量门全绿：`pnpm lint`（含 clippy `-D warnings`，注意平台专属 import 的 cfg 门控）、`cargo test --manifest-path src-tauri/Cargo.toml`。
