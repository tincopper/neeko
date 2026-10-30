# 执行计划：Pi 历史会话恢复为 Agent Chat

> 需求见 `prd.md`，设计见 `design.md`。TDD：每项先写失败测试（Red）→ 实现（Green）→ 重构。
> 阶段独立可回滚；P1/P2 在 `src-tauri/`，P3 在前端。

## P0 · 事实复核（已在规划期完成，记录备查）

> 实施补充（偏离 design 的两处，均为测试逼出来的）：
> 1. `process.rs` 除 `pending.clear()` 外还需 `ended` 标志 —— 覆盖「进程先退出 / clear 跑完 → 请求才注册」窗口，否则该窗口仍等满 5s。
> 2. `annotate` 改为 `async` 并有界等待（≤300ms）stderr 排空 —— 否则错误信息会随机丢掉 pi 的真实原因。
> 3. `PiSession::start`（spawn 入口）随之上收到 `PiRpcAdapter::spawn_process` 后删除（无消费者）。


- [x] 实测 `pi --mode rpc --session <uuid>` → `get_state.sessionId` 相同、`messageCount: 55`
      （可恢复，非能力缺失）。
- [x] 实测 `pi --mode rpc --session <不存在>` → exit 1 + stderr
      `No session found matching '<id>'`（失败原因在 stderr）。
- [x] 确认 `launch_args` 后写者胜规则（`process.rs` 文档）与 `chat_cmd_vec` 形状
      （`pi --mode rpc`）。

## P1 · pi chat 恢复可用（R1，修复 AC1/AC2）

- [x] 1.1 `adapter/pi_rpc/adapter.rs`：抽出 `extra_args(cmd, tail)` 纯函数 +
      `spawn_process(ctx, tail)`；`create()` 改为 `spawn_process(ctx, &[])`（行为不变）。
      **Red**：`extra_args` 顺序测试（tail 紧跟 user args，不能被 `--mode rpc` 落到前面）。
- [x] 1.2 `ensure_bound_to(requested, actual)` 纯函数 + 测试（相等 / 不等 / `None`）。
- [x] 1.3 `resume()`：`spawn_process(ctx, &["--session", id])` → `PiSession::start_with`
      → `ensure_bound_to` → `Box::new(session)`；失败路径 `cancel()` 回收。
- [x] 1.4 `supports_chat_resume() -> self.chat_capabilities().resume`。
      **Red**：契约测试 —— `caps.resume == supports_chat_resume()`；
      用不存在的二进制调 `resume()`，错误必须是 spawn/IO 类（非 `Unsupported`，
      证明覆写存在，红线 14 同源）。
- [x] 1.5 验证：`cargo test --manifest-path src-tauri/Cargo.toml --lib pi_rpc`；
      `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings`。
- **回滚点 A**：`feat(agent-chat): resume pi native sessions as live chat`。

## P2 · 失败快且可归因（R2，修复 AC3）

- [x] 2.1 `process.rs` 读循环结束 → `pending.clear()`
      **Red**：`from_split` 夹具 —— 请求发出后关闭对端，断言错误在远小于
      `AUX_TIMEOUT` 的时间内返回，且文案为 `process ended before responding`。
- [x] 2.2 `process.rs` 保留 stderr 尾部（有界 ~2KB）+ `stderr_tail()` + `annotate()`；
      `append_stderr(err, tail)` 纯函数 + 测试（空 tail 原样返回）。
- [x] 2.3 `session.rs` 抽出 `handshake(proc)`，`start_with` 失败时
      `.map_err(|e| proc.annotate(e))`。
      **Red**：握手失败 + 注入 stderr tail → 错误信息包含该 tail。
- [x] 2.4 验证：`cargo test --lib pi_rpc`；`cargo clippy -D warnings`。
- **回滚点 B**：`fix(agent-chat): surface pi stderr and fail fast on process exit`。

## P3 · 入口显隐收敛到唯一真相（R3，修复 AC4/AC5）

- [x] 3.1 新增 `src/features/agent-chat/utils/chatResumeSupport.ts`（**审查轮从 `api/` 迁来**：
      带缓存/失效键/失败口径的门面是领域策略，`api/` 只留薄封装；spec `api-layer.md` 补了原则 6）：
      `supportsChatResume(agentId)`（每个 agent 一条缓存，键含启动签名
      `chatLaunchSignature(chat, chat_enabled)`，异常缓存 false，空 id 短路）。
      **Red**：`api/__tests__/chatResumeSupport.test.ts` —— 同一 agent 两次只 IPC 一次 /
      失败缓存 false / 空 id 不 IPC / **改 chat 传输或 `chat_enabled` 后重查**。
- [x] 3.2 `src/features/agent-chat/hooks/useChatResumableAgents.ts`：
      输入 `agents`，输出 `Set<string>`（并行解析，卸载安全）；依赖是
      `[id, 启动签名]` 的序列化投影（数组身份变不重查 / 配置变要重查）。
- [x] 3.3 `ConversationsPanelWrapper` → `ConversationPanel` → `ConversationList` →
      `ConversationItem` 传 `canChatResume?: (agentId: string) => boolean`；
      chat 按钮条件加 `canChatResume(meta.agentId)`，并**移出**
      `meta.supportsResume === true` 的外层 gate（两个正交轴，见 design §2.4 的实施修正）。
      **Red**：`ConversationItem.test.tsx` —— 不支持时无 `Open in Agent Chat` 按钮，
      支持时仍在；能力未知时不显；`supportsResume=false` 时只隐藏 `Resume`
      （chat 入口不受影响）。
- [x] 3.4 `useChatRestore.loadResumableList` 过滤：`nativeSessionId` **且**
      `supportsChatResume(agentId)`。
      **Red**：新增 `hooks/__tests__/useChatRestore.test.ts` —— mock
      `listConversations` + `supportsChatResume`，断言只保留支持的 agent 条目。
- [x] 3.5 验证：`pnpm check:quick`（收尾只跑一次）。

## 审查轮补充（审查发现，独立于 pi 恢复本身 —— 建议单独 commit）

- [x] 4.1 `.eslintrc.cjs` 的 `FEATURE_DIRS` 缺 `agent-chat` / `search` ⇒ 两个域的跨域私有导
      **完全不受防火墙约束**（app 层可直引 `agent-chat/hooks/*`）。已补齐两个条目。
- [x] 4.2 同一清单里 `debug` 是陈旧条目（`src/features/debug/` 已在 `570463bd` 删除）⇒ 删除。
- [x] 4.3 门面收敛：`agent-chat/index.ts` 导出 `useChatResumableAgents`，
      `ConversationsPanelWrapper` 改经门面；`SearchPanel` 的 `@/features/quick-open/openFile`
      深引改经 `@/features/quick-open`。
- [x] 4.4 **根因护栏**：新增 `check_feature_firewall_coverage`（清单 ↔ 磁盘双向校验，
      块缺失报失效）+ 8 条用例 + `invariants.json` 登记；`test_gates.py` 的进程内护栏
      计数 32 → 33。spec `frontend/quality-guidelines.md` 记录判据。

## 审查轮补充 2（评审遗留项，独立于 pi 恢复本身 —— 建议单独 commit）

- [x] 5.1 **进程生命周期 ⊆ 句柄生命周期**：`PiRpcProcess` 加 `impl Drop { dispose() }`。
      缺陷是握手失败（`start_with` 的 `?` 早退）后 spawn 的 pi 进程无人回收 —— 每失败一次
      漏一个；`create` / `resume` 同构，所以修在类型上而不是每个调用点。
      `dispose()` 改用 `Handle::try_current()`（无 runtime 时原先会 panic，Drop 里 panic = abort）。
      可观测性：`from_split_with_hooks` 注入 `KillProbe`（kill 句柄同步调用 ⇒ 计数同步可见，
      用例不 sleep），4 条用例（含反向护栏「持有期间不得杀」）。
- [x] 5.2 **答不出 ≠ 答 false**：`supportsChatResume` 的失败不再入缓存（只删本次条目，下一次
      重问），本轮仍返回 false（fail-closed 显示）。`agent_chat_supports_resume` 自身从不返回
      Err，故 reject 只可能是 IPC 层问题 —— 旧实现让一次抖动把入口隐藏到重启。用例：失败重问 +
      并发合并。

## 收尾（Phase 2.2 / 3.3 / 3.4）

- [x] AC1–AC7 逐条勾验。**AC2/AC3 已由真机探针验证**（真 pi 进程，跑完删除）：header id 恢复
      → `resume_id` 等于请求值；不存在的 id → 1.22s 失败且错误带 pi 的 stderr；反证用文件名 stem
      恢复会被 pi 拒绝（`No session found matching`）。AC1 与 AC2 是同一条代码路径，GUI 外观属
      人工一瞥（入口显隐已有单测）。
- **review 教训（本轮自查）**：第一次真机探针把**文件名 stem** 喂给 `resume()`，据此误判成
      「Block 缺陷」；实际生产路径取的是会话文件 header 的 `id`。教训：真机探针必须与生产**同源**
      地构造入参（这里 = 读 header），否则量出来的是探针的行为，不是代码的行为。
- [~] 同步 spec：`.trellis/spec/backend/agent-chat-transports.md`（pi resume 取证与
      参数顺序规则）、必要时 `lsp-domain.md` 之外的同类能力一致性条目。
- [x] `pnpm check:quick` 绿 + `cargo test --lib` 绿（2332 passed）。

## 审查轮（trellis-check，2026-10-30）

- [x] `ConversationItem` 的 chat 入口拆出 `meta.supportsResume` 外层 gate（两个正交轴）。
- [x] 能力缓存键含启动签名；`useChatResumableAgents` 依赖同一份签名（配置变更不再失真到重启）。
- [x] `annotate` 用 `Notified::enable()` 同步注册唤醒（原注释声称的「不丢唤醒」此前不成立）。
- [x] `process.rs` 两个用例去掉 `sleep(30ms)` / `sleep(20ms)` 的顺序赌注，改轮询进程级标志
      （后者原本在慢机上会退化成走 `clear()` 分支 = 假护栏）。
- [x] `spawn_in(cwd, tail)` 收敛 program/args/env 拼装（`list_commands` 与会话路径共用一份）。
- [ ] `add_session.py` 记录会话；**不主动提交**（等用户确认）。
