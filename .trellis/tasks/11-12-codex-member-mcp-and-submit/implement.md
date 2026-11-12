# implement — 落地顺序（TDD：先红后绿，每步都留一个变红的判据）

> 改动面：`src-tauri/src/server/gate.rs` · `src-tauri/src/agent/team/boot.rs` ·
> `src-tauri/src/agent/team/admission.rs` · `src-tauri/src/agent/team/delivery.rs` ·
> `src-tauri/src/app/team_executor.rs`。零前端改动、零迁移、零新命令。

## 动手前（必读，硬指令）

- [ ] Read `src-tauri/AGENTS.md`（红线 1/3/5/6/7/9/14/15 落点）。
- [ ] Read `.trellis/spec/backend/team-domain.md` §2.2（两相位与投递协议）、§2.3（端点与门的
      活集合）、§3（准入表 / 凭证进 env 的唯一例外）。
- [ ] Read `.trellis/spec/security/allowlist.md`（门的单一裁决点与恒定时间比较）。
- [ ] 读 `research/00-evidence.md`：证据要能被复查（SQL / 日志行 / codex 源码坐标）。

## 阶段 A：断链 1（门接受 Bearer）

### A1 红：护栏测试先写

`agent/team/boot.rs` 的 `#[cfg(test)] mod tests` 增加：

- [ ] `the_team_gate_accepts_both_advertised_shapes`
      - 明文 token `tok-…`，`SharedTokenSet::new(vec![hash_token(tok)])`（用既有的
        `identity::hash_token`，不要自造编码）。
      - `x-neeko-team-token: <tok>` ⇒ `authorize == true`
      - `authorization: Bearer <tok>` ⇒ `authorize == true`
      - `authorization: Bearer <错>` / 无头 ⇒ `false`
- [ ] `the_team_gate_rejects_everything_when_the_set_is_empty`（空集合 + 两种形状都拒）
- [ ] 确认这两条 **Red**（`BearerToken` 还不存在时就该编译失败 / 断言失败）。

### A2 绿：实现

- [ ] `server/gate.rs`：新增 `pub struct BearerToken;` + `impl CredentialExt`（只提取、不比较；
      严格 `strip_prefix("Bearer ")`，注释写明为什么不宽容）。
- [ ] `server/mod.rs`：`pub use gate::{…, BearerToken}`。
- [ ] `agent/team/boot.rs`：抽出 `pub(crate) fn team_gate(tokens: SharedTokenSet) -> AuthGate`，
      `boot()` 改用它；`use` 补 `BearerToken`。
- [ ] 重跑两条测试 ⇒ Green。

### A3 变异验证（AC2，贴到 PR 说明）

- [ ] 临时删掉 `Arc::new(BearerToken)` → `the_team_gate_accepts_both_advertised_shapes` 必须红
      → 恢复。

## 阶段 B：断链 2（投递提交形态）

### B1 红：纯函数测试先写

`agent/team/delivery.rs`：

- [ ] `bracketed_paste_wraps_the_body_and_keeps_enter_separate`
      `pty_write_plan("hi", PtySubmit::BracketedPaste)` ⇒
      `text == b"\x1b[200~hi\x1b[201~"`，`enter == b"\r"`，`gap == PTY_WRITE_GAP`。
- [ ] `plain_plan_is_byte_identical_to_the_original_protocol`（`text == b"hi"`）
- [ ] `the_wrapper_survives_multiline_and_utf8_bodies`（`"line1\n中文"` 只被包裹、不被改写）
- [ ] `only_the_pty_channel_gets_a_write_plan`：扩成 2 种 submit × 3 档通道，`Mcp`/`None`
      两种 submit 都必须 `Unsupported` 且理由仍指向 `task_create`。

`agent/team/admission.rs`：

- [ ] `codex_uses_bracketed_paste_and_everyone_else_is_plain`：
      `admission_for("codex").unwrap().pty_submit == PtySubmit::BracketedPaste`，
      且 `ADMISSIONS` 里其余行的 `pty_submit == PtySubmit::Plain`（一条数据变更会被看见）。

### B2 绿：实现

- [ ] `delivery.rs`：加 `pub enum PtySubmit { Plain, BracketedPaste }`（文档写清「为什么是数据、
      为什么不是默认值」）；`pty_write_plan(message, submit)` 按 submit 拼第 1 笔；
      `route(channel, submit, message)` 透传。`PtyWritePlan` 字段与「恒两笔」契约不动。
- [ ] `admission.rs`：`use crate::agent::team::delivery::PtySubmit;`，`AgentAdmission` 加
      `pub pty_submit: PtySubmit`，`ADMISSIONS` 每行补值（只有 codex 是 `BracketedPaste`），
      新增 `pub fn pty_submit_for(agent_id: &str) -> PtySubmit` —— **内部必须复用既有
      `admission_for(agent_id)`**（`same_id` 归一化在那里），未登记 → `Plain`。不要另写一遍
      `agent_id ==` 查表：`per_cli_facts_live_only_in_the_table` 会把它当成第二条事实源。
- [ ] `app/team_executor.rs::deliver`：`let submit = admission::pty_submit_for(&member.agent_id);`
      → `delivery::route(member.channel, submit, message)`。
- [ ] 全仓搜 `delivery::route(` / `pty_write_plan(`，把测试里的调用点补齐（**不留旧签名**）。
- [ ] 重跑阶段 A + B 的全部测试 ⇒ Green。

### B3 单测覆盖不到的那一段（不 mock，靠手工）

- [ ] `cargo test -p neeko agent::team` 绿；`cargo clippy --all-targets -D warnings` 绿。

## 阶段 C：手工验证（AC6）

- [ ] `pnpm tauri dev`（或用户当前运行的 dev 实例重启）→ 建一个含 **codex 成员**的团队。
- [ ] 成员侧：`task_list` 能列出板；`task_claim` 成功；**看板 / 分配图的节点状态与 owner
      随快照更新**（这正是用户报的第一个症状）。
- [ ] 队长侧：`team_send` 给 codex 成员投递一行消息 → codex TUI 里该消息**自行提交**
      （不再停在输入框），必要时连投 3 次确认稳定。
- [ ] 反证：给 pi / claude-code 成员投递一次，确认行为未变（`Plain`）。
- [ ] 复查日志：`~/.neeko/neeko.log` 里不再出现 `auth gate rejected request to /team/mcp`
      （成员启动后的握手窗口）。

## 阶段 D：收尾

- [ ] `pnpm check:quick`（只跑这一次；它含静态检查 + 改动文件相关单测）。
- [ ] 更新 spec（`trellis-update-spec` 或手工）：
      - `.trellis/spec/backend/team-domain.md`
        - §2.3 的门的表格补一行「门接受**准入表宣传的每一种鉴权形状**（自定义头 + Bearer）」，
          并点名 `team_gate()` 是唯一构造点。
        - §2.2 的「`Pty` 投递恒为两笔」段：补「正文的**提交形态**是 per-CLI 数据
          （`PtySubmit`），codex 用 bracketed paste —— 裸正文 + `\r` 会被 paste-burst 吞掉回车」。
        - §3 准入表：字段清单补 `pty_submit`（并写清它是「怎么提交」而不是「怎么发」，与
          `channel` 那一段的边界一致）。
- [ ] 会话归档：`python3 ./.trellis/scripts/add_session.py --title … --commit <hash>`
      （**不要主动提交代码**，等用户确认）。

## 判据汇总（谁红说明哪里退化了）

| 退化 | 变红的测试 |
| --- | --- |
| 门又只认一种形状 | `the_team_gate_accepts_both_advertised_shapes` |
| 空集合被放宽 | `the_team_gate_rejects_everything_when_the_set_is_empty` |
| codex 的提交形态被改回 Plain | `codex_uses_bracketed_paste_and_everyone_else_is_plain` |
| 包裹字节写错 / 被 trim 掉 | `bracketed_paste_wraps_the_body_and_keeps_enter_separate` |
| Plain 形态被顺手改了 | `plain_plan_is_byte_identical_to_the_original_protocol`（既有断言） |
| 非 Pty 通道被误放开 | `only_the_pty_channel_gets_a_write_plan` |
