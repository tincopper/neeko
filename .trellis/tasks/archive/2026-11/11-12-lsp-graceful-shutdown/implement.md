# 实施计划：LSP 关闭序列单一化

TDD 顺序：每一步先写失败测试（Red）→ 最小实现（Green）→ 下一步。**禁止**先改实现再补测试。

开发中的红绿观察用单条命令，不要整仓跑：

```bash
cargo test --manifest-path src-tauri/Cargo.toml --lib <用例名>   # 单个用例
cargo test --manifest-path src-tauri/Cargo.toml --lib lsp::        # LSP 域
```

收尾只跑一次 `pnpm check:quick`；另需显式跑一次 `cargo test --lib`（`check:quick` 改 `.rs`
时不跑 cargo test，属已知缺口，见 AGENTS.md「覆盖面要诚实」）。

---

## S1 · `LspProcess::wait_exit` 原语（`lsp/process.rs`）

- [ ] **Red**：`wait_exit_returns_true_when_process_gated_exited`、`wait_exit_times_out_and_returns_false`。
      用 `#[cfg(test)] LspProcess::test_stub(exited: Arc<AtomicBool>)` 构造，**不 spawn 进程**。
- [ ] **Green**：把 `bridge_exec_child` 里的 `(done_tx, done_rx)` 换成
      `Arc<(Mutex<bool>, Condvar)>` 退出门；`wait_exit(&mut self, grace) -> bool`
      用 `Condvar::wait_timeout`。`kill()` 保持既有语义（发 kill 信号 + 2s drain）。
- [ ] **回归**：既有 `kill` 相关测试全绿；`cargo test --lib lsp::process` 通过。

**Gate A**：`wait_exit` 的超时路径有测试覆盖，且测试里没有真实服务器进程、没有真实秒级 sleep。

## S2 · `send_shutdown_request_bounded`（`lsp/session/instance.rs`）

- [ ] **Red**：
      - `shutdown_request_is_a_request_not_a_notification`：断言写进 writer 的报文是
        `Message::Request` 且 `method == "shutdown"`。
      - `shutdown_request_times_out_when_server_stays_silent`：响应永不到达时在 timeout 内
        返回 `Err`（不允许无界阻塞），且 `pending` 表已清空（对齐
        `await_init_response_fails_fast_when_reader_dead` 的既有不变量）。
- [ ] **Green**：看门狗线程在 timeout 到期时把该 request id 从 `pending` 摘除
      （复用 `drain_pending` 机制）；保留既有 `send_shutdown_request()` 不使用超时的等价语义
      或直接替换（若替换，检查所有调用点）。
- [ ] **回归**：`await_init_response_*`、`drain_pending` 相关测试全绿。

**Gate B**：无界 `blocking_recv` 在关闭路径上已不存在（`rg -n 'blocking_recv' src-tauri/src/lsp` 逐个确认）。

## S3 · 关闭序列测试先行（`manager.rs` + `session/testing.rs`）

- [ ] **Red**（先只写测试，`shutdown_and_exit` 尚不存在）：
      - `stub_session_with_writer`（`session/testing.rs` 新增）返回 writer receiver。
      - `project_deactivate_sends_shutdown_request_then_exit`：第一条 = `Request{shutdown}`，
        第二条 = `Notification{exit}`（AC2）。
      - `no_kill_before_shutdown_response`（AC3）：注入「收到 shutdown 就视为失败」的假进程，
        断言 kill 未被调用。
      - `hung_server_is_killed_after_grace`（AC4）：`exited` 恒 false 的假进程 + 极短宽限 →
        最终 kill 被调用一次，且函数返回（有界）。
      - `close_session_and_project_deactivate_share_one_sequence`（AC1 的数据化表达）：
        两条入口产生的报文序列**逐条相等**。
- [ ] 确认 Red（编译失败也算 Red 的一种，但要确保失败原因指向缺失的实现而不是笔误）。

## S4 · 归并实现（`manager.rs`）

- [ ] **Green**：新增唯一实现

      fn shutdown_and_exit(mut session: LspSession) {
          // 1) shutdown request（有界）
          // 2) exit notification（写失败容忍）
          // 3) wait_exit(grace) → 仍活着才 kill_child()
      }

- [ ] `close_session_impl` 的 `spawn_blocking` 块改为调用它（去掉手写的
      `send_shutdown_request` + `exit` + 立即 `kill_child`）。
- [ ] `close_sessions_for_project` 改为：收集会话 → 单个 `spawn_blocking` 里**串行**调用它；
      删除 `send_notification_raw("shutdown")` 与 `sleep(10ms)`。
- [ ] 保留：终态先落（`close()` / `close_silently()`）、`profiles.remove`、
      `attempt_diag.evict_project`、末尾那行 `log::info!` —— 这些是 R6 的不变量。

**Gate C**：`rg -n 'send_notification_raw\("shutdown"' src-tauri/src` 零命中；
`rg -n 'thread::sleep' src-tauri/src/lsp/manager.rs` 不再出现在关闭路径。

## S5 · 宽限期进插件数据（`plugin/types.rs` + `builtins/java.rs`）

- [ ] **Red**：`LspServerTuning` 默认值测试、`java_plugin_declares_jdtls_tuning` 补一条
      `shutdown_grace_ms > Default::default().shutdown_grace_ms`、
      `non_java_builtins_keep_generic_tuning` 补一条「非 java 必须是默认值」。
- [ ] **Green**：加字段（默认 2_000ms）+ java 插件声明 10_000ms；会话创建时把它落到
      `LspSession::shutdown_grace`（`testing::stub_session` 给短值，避免测试走真实长等待）。
- [ ] 确认没有出现 `language_id == "java"` 分支（红线 15）。

**Gate D**：`rg -n 'language_id == "java"' src-tauri/src` 零命中。

## S6 · 收尾验证

- [ ] `cargo test --manifest-path src-tauri/Cargo.toml --lib` 全绿（≈2600 用例）。
- [ ] `pnpm check:quick` 通过（静态检查 + 相关前端单测 + 仓库护栏）。
- [ ] `rg -n 'wait_exit|shutdown_and_exit|shutdown_grace' src-tauri/src` 复核落点唯一性。
- [ ] 手工验证（本机，jdtls）：先清掉损坏 workspace

      rm -rf ~/Library/Caches/jdtls/jdtls-<sha1(basename)>

      打开 Java 工程 → LSP Ready → 切走项目并等待停用（或临时把
      `DEFAULT_DEACTIVATE_STOP_SECS` 调小做一次验证）→ 再次打开，
      `<data>/.metadata/.log` 中**不得**出现
      `The workspace exited with unsaved changes in the previous session`。

## S7 · 文档

- [ ] `.trellis/spec/backend/lsp-domain.md` 增一节「关闭序列（唯一实现 + 三步有界）」，
      写明：`shutdown` 是 request、不允许 notification、`exit` 后必须等进程退出、
      宽限期是插件数据、违反的现场症状（`exited unexpectedly` + `.metadata/.log` 里的
      `Application error`）。
- [ ] 若 `dap/session.rs` 有关闭路径同形缺陷，仅在 spec 中记录，不扩本任务范围。

---

## 回滚点

- S1/S2 可独立回滚（纯新增原语）。
- S4 是本 bug 的实际修复点：回滚它即回到硬杀行为，与其他步骤无耦合。
- 全程无 schema / wire / 事件变化，回滚不需要迁移。

## 提交拆分建议

1. `test(lsp): pin the close protocol with observable writer sequence`（S3，含 skip 或先红后绿的合并）
2. `feat(lsp): wait for process exit with a bounded grace`（S1+S2）
3. `fix(lsp): close every session through one protocol-compliant sequence`（S4）
4. `feat(lsp): declare per-server shutdown grace in plugin data`（S5）
5. `docs(spec): record the single close sequence`（S7）

> 实际提交时按仓库约定走 `neeko-commit` skill，且**不主动提交**。

---

# T0 追加（审计整改，2026-11-12 第二轮）

来源：`research/audit-{lifecycle,channel,orchestration,contracts}.md`（4 个维度独立审计）。
T0 只收「会抵消本次关闭协议」的 5 条；其余 26 条见 `prd.md` 的「T1 台账」，另立项。

## T0-1 退出清理两阶段：优雅域先收尾，收割器最后跑

- 问题：`app_state.rs:126` + `common/shutdown.rs:26` 把所有 CleanupTask 并行 spawn，
  `("git-children", kill_all_live)` 与 `("lsp", close_all_sessions)` 同时开跑。LSP 因
  `with_kill_tree()` 恒在收敛表里 ⇒ `kill_all_live` 的 SIGKILL 毫秒级到达，而 checkpoint 要秒级
  ⇒ **每次退出仍截断**（把刚修的项目停用路径换成退出路径重演）。
- 改法：`common/shutdown.rs` 拆出可测的 `run_cleanup_phases(tasks, finalizers)`（不 exit），
  `run_cleanup_and_exit(tasks, finalizers)` 在线程里跑它再 `process::exit(0)`；
  `app_state.rs` 把 `("git-children", …)` 从 tasks 移到 finalizers。
- 判据：finalizer 只能看到所有 task 都已完成。测试：task 写标记 → finalizer 断言标记已置（共享 `Mutex<Vec<&str>>` 记录顺序）。
- 同步改 spec：`concurrency-guidelines.md` 里「在所有后台服务关停**前**调 `kill_all_live`」表述反转。

## T0-2 退出预算必须是**总计**

- 问题：`manager.rs::close_all_sessions` 传 `budget`，而 `shutdown_and_exit_with` 把同一个
  `budget` 分别喂给 `send_shutdown_request_bounded` 与 `wait_exit` ⇒ 3s 预算实际能拖 6s。
- 改法：`shutdown_and_exit_with(session, budget)` 内部算一次 `deadline = Instant::now() + budget`，
  两步各取 `remaining(deadline)`。
- 判据：`exit_budget_is_a_total_not_per_step` —— budget 120ms + 沉默服务器，总耗时 < 200ms
  （按步实现会 ~240ms 以上）。

## T0-3 关闭与创建共用 per-key 门（stop 不再 fire-and-forget）

- 问题：`close_session` 只 `spawn_blocking(shutdown_and_exit)` 就返回；会话已从 store 摘除，
  用户立刻敲键 → `ensure_session_async` 直接 spawn 第二个 jdtls → 抢同一 `-data` 锁。
  （重启路径上一轮已 await 收口，stop 与项目停用两条漏了。）
- 改法：关闭路径在**阻塞任务内**先拿该 key 的 creation gate（`creation_locks`，与
  `get_or_create_session` 慢路径同一把），再 `take_for_close` + 跑序列，最后放门。
  `close_session` 签名改 `self: &Arc<Self>`（`lsp_manager` 已是 `Arc`）。
  `close_sessions_for_project` 同样逐 key 持门。
- 判据：`stop_holds_the_creation_gate_until_the_sequence_finishes` —— 另起线程抢同一把门，
  记录拿到门的时刻，必须晚于 `notification:exit` 被写下。
- 不做（T1 台账）：创建中收到关闭的「墓碑」语义（装配完成后核对关闭代）。

## T0-4 initialize 握手必须有 deadline

- 问题：`session/instance.rs::await_init_response` 的 `blocking_recv()` 只由 reader 退出解除；
  服务器活而不答（jdtls 撞 `-data` 锁正是这种）⇒ 线程与 per-key 门永久占用 ⇒ 该 key
  所有 LSP 命令悬挂，前端每条 invoke 永不 settle。
- 改法：加 `deadline`，实现与 `send_shutdown_request_bounded` 同构（看门狗到期摘 `pending` 发送端，
  `blocking_recv` 立刻以「no response received」失败）。预算取
  `plugin.request_timeout_ms`（java/rust 声明 120s），未声明回落到 `INIT_TIMEOUT_DEFAULT`（60s）。
- 判据：`await_init_response_fails_when_server_stays_silent` —— 50ms 预算、无响应、reader 存活，
  必须在 ~50ms 内 Err 且 `pending` 已清空。
- 失败后必须走既有装配失败收尾（kill 进程 + 单次终态文案），不得泄漏进程。

## T0-5 前端：extension map 不得丢 `requestTimeoutMs`

- 问题：`src/features/lsp/store/lspStore.ts:468` 与
  `src/features/settings/components/LspPanel.tsx:36` 两处 mapper 只搬 4 个字段 ⇒
  `requestTimeoutMsByLanguage` 恒空 ⇒ `lspClientTimeout()` 恒 15s ⇒ java/rust 声明的 120s 从未生效
  （jdtls 冷启动、RA 首跳 95–98s 必超时）。现有护栏直接给 `applyBackendExtensionMap` 传参，
  绕过了被破坏的 mapper。
- 改法：`lspApi.ts` 增加单一映射函数 `toExtensionMapEntry(dto)`（全字段透传），两处调用它。
- 判据：新增 mapper 测试——构造**全字段** DTO，断言映射结果逐字段相等（丢任何一个字段即红）。

## T0 验证

```bash
cargo test --manifest-path src-tauri/Cargo.toml --lib lsp::
cargo test --manifest-path src-tauri/Cargo.toml --lib shutdown
pnpm test:fe -- lspClientManager   # 或 vitest related src/features/lsp
pnpm check:quick
```
