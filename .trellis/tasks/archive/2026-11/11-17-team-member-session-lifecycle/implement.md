# Implement — 团队成员会话的侧栏生命周期修复

执行顺序：**Red → Green → Refactor**，每条变更先有失败测试。

## 1. 写门排除团队会话（R1 / AC1 / AC2）

- [ ] **Red** `src-tauri/src/live_sessions/cursor.rs` 的 `#[cfg(test)]`：新增
      「`TeamMember` 条目 + `has_user_input=true` ⇒ `from_entry` = `None`」，
      并断言同输入的 `User` 条目仍为 `Some`（防过度过滤）。
- [ ] **Green** `ResumeCursor::from_entry` 在 `has_user_input` 写门之后（或与之并列）加归属判据：
      `SessionAttribution::TeamMember { .. } ⇒ None`。注释写清**为什么**（进程没了就没有入口；
      恢复归 `team_resume`，它铸新 terminal id，落库旧行会成为永久孤儿）。
      **判据只在这一处**：`Registry::write_entry` / `persist_entry` 不得再写第二份。
- [ ] **Red** `src-tauri/src/live_sessions/registry/tests.rs`：登记 `TeamMember` 会话 →
      `report_user_input`（或 `report_authoritative`）置位 → 断言 `store.list_restorable()` 不含它，
      且 `restore_from_store()` 后 `registry.entry(id)` 为 `None`。
- [ ] **Green** 通常无需额外代码；若测试失败说明写门还有第二个入口，把它收敛到 `from_entry`。

## 2. 修正失实注释（R3）

- [ ] `src-tauri/src/live_sessions/cursor.rs::into_entry` 里
      「持久化行不存归属：用户手机会话（团队成员的会话不走这条恢复路径）」改成事实：写门在
      `from_entry` 已经排除 `TeamMember`，能走到这里的行**只可能**是 `User` 归属；归属不落库是有意为之。

## 3. 删除守卫（R2 / AC3 / AC4）

- [ ] **Red** `src-tauri/src/app/session_lifecycle.rs` 的测试：
      - `registered_with_attribution(TeamMember)` + `router.register_owner_for_test(id)` →
        `delete_session(...)` 返回 `Err(_)`，`router.owns_terminal_session(id)` 仍为 `true`，
        `registry.entry(id)` 仍为 `Some`；
      - 既有三条测试（unknown / chat / terminal）改成 `Result` 断言，行为断言不变。
- [ ] **Green** `delete_session` 返回类型改 `Result<bool, AppError>`：
      第一步读 `registry.entry(session_id)` 的归属，`TeamMember` ⇒ 立即
      `Err(AppError::Conflict("<可独立读懂的英文句子：这条会话属于团队成员，请在 Team 面板关闭它>"))`；
      之后编排顺序（先停进程、再摘条目）保持原样。命令层 `delete_live_session` 直接透传 `?`。
- [ ] 检查**没有**其他调用点依赖旧的 `bool` 返回（`grep -rn "delete_session(" src-tauri/src`）。

## 4. 验证

- [ ] `cd src-tauri && cargo test live_sessions`
- [ ] `cd src-tauri && cargo test session_lifecycle`
- [ ] `cd src-tauri && cargo clippy --all-targets -- -D warnings`（若耗时过长由 `pnpm check:quick` 兜底）
- [ ] `pnpm check:quick`（收尾只跑一次）

## 5. 文档同步（AC6，Phase 3.3）

- [ ] `.trellis/spec/backend/agent-chat-transports.md`：
      - 「侧栏列出哪些会话」段落补一条：**归属为团队成员的会话不落 cursor 行**（写门）；
      - 「删除」段落补一条：`delete_live_session` 对团队成员会话判负（成员生命周期归团队域）。
- [ ] `.trellis/spec/backend/team-domain.md`：在成员会话登记 / 侧栏归属相关小节
      **指向** `agent-chat-transports.md` 的那两条判据（不复制第二份正文）。

## 回滚点

- 三处改动互相独立：写门（R1）、注释（R3）、删除守卫（R2）。任一引起回归可单独 revert，
  不影响另外两条合入。
