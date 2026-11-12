# 审计：LSP 请求/响应通道、握手与并发原语

范围：`lsp/session/{instance,request,notify,status,utils}.rs`、`inflight.rs`、`session_factory.rs`、
`document_open.rs`、`server_request.rs`（+ 追到 `manager.rs` / `session_store.rs` / `commands.rs` / `process.rs` 的边界）。
已既定：本次关闭序列、jdtls `-data` 归属、`.metadata/.log` 文案、`lsp-domain.md` 已记录取舍 —— 不重复报告。
只审计，未改任何代码。

---

## 1. 真缺陷（按严重度）

### D1 握手无超时 + 创建门跨整段握手持有 → 单次卡死冻结整个 key 的全部 LSP

- 位置：`session/instance.rs:842`（`await_init_response` → `init_rx.blocking_recv()`，无 deadline）、
  `manager.rs:561`（`let _creation_guard = gate.lock();`，guard 活到函数结束，包住 `session_factory.build`）。
- 条件：进程 spawn 成功但服务器**不答** `initialize`（jdtls 撞 `-data` workspace 锁、OSGi 卡死、JVM 假活）。
- 坏法：`blocking_recv` 只由 reader 退出解除；服务器活而不答 ⇒ 永不解除。
  `spawn_blocking` 线程与 per-key `parking_lot::Mutex` 一并永久占用 ⇒ 该 key 后续每条
  hover / didOpen / definition 都在 `ensure_session_async` 里排到 gate 上，阻塞池被逐条耗尽，
  表现为全应用 LSP 冻结、前端每条请求无限 pending。可观测性为零（只有 read 级日志）。
- 最短反例：`instance.rs:842` 等待 ↔ `manager.rs:561` 持门，两者之间不存在任何 deadline；
  reader 线程不退出（连接还开着），`drain_pending` 也就永不触发。
- 建议：`initialize` 给 deadline（插件数据，如 `tuning.init_timeout_ms`），到期按 init 失败路径
  收尾（kill + 证据内联），并把「服务器不答握手」写进 outcome。

### D2 服务器 JSON-RPC error 响应被当成会话故障 → 静默重启整台语言服务器

- 位置：`session/request.rs:119` `bail!("LSP error ({}): {}")` → `manager.rs:785`
  「Will restart」→ 走重启分支（`restart_count + 1`）。
- 条件：任一次请求收到 error response（`-32601` 未实现、`-32602` 文档未打开、jdtls 自定义错误码）。
  最常见的真实交错：`textDocument/didClose` 刚发出、definition/completion 立刻到达服务器 → `-32602`。
- 坏法：整台服务器被重启（jdtls 数十秒不可用、重新导入），`restart_count` 连续消耗，
  5 次后 `Max restart count exceeded for <key>` → 该语言**永久**不可用；
  用户侧只看到「跳转失败 / 补全为空」，日志里是一条 warn。
- 建议：把「服务器答了错」与「通道断了」分开。前者是请求级失败（`AppError` 直接上抛，
  不重启），后者才进重启预算。

### D3 非重启关闭路径不等待收口 → 同 key 立刻重建，两个服务器争同一把 workspace 锁

- 位置：`manager.rs:925-936`（`close_session_impl` → `spawn_blocking(shutdown_and_exit)` **不 await**）、
  `manager.rs:939-957`（项目停用同理，只把多个会话串行丢给阻塞池）。
- 条件：状态栏 Stop / 项目停用 / `lsp_stop_session` 之后，关闭序列还在跑（java：请求宽限 10s +
  退出宽限 10s ≈ 20s 窗口）期间，任何一次 hover / didOpen 触发 `ensure_session_async`。
- 坏法：store 里条目已被 `take_for_close` 摘除 ⇒ `get_or_create_session` 立刻 spawn 第二个 jdtls，
  两者共用同一 `-data` ⇒ 第二个抢锁失败 / 卡在 initialize ⇒ 命中 D1 ⇒ 该 key 彻底卡死。
  这与本任务要修的 workspace 损坏是同一现场，只是触发者从「硬杀」换成了「立刻重启」。
- 建议：关闭序列必须 per-key 收口（在 gate 内等旧进程退出，或把 `shutdown_and_exit` 的 JoinHandle
  放进 key 级表，`get_or_create_session` 先 await 它）。

### D4 三套 id 生成器共用一个以 id 为唯一键的 pending 表

- 位置：`session/instance.rs:467` `RequestId::from(1i32)`（initialize）、
  `instance.rs:598` `RequestId::from(1000i32)`（shutdown）、
  `session/request.rs:17/73` `static NEXT_REQ_ID`（业务请求，进程级）。
- 条件：`NEXT_REQ_ID` 恰好走到 1000（任何活跃会话累计 1000 条请求后每次绕回都会再撞），
  且该会话此刻正在 shutdown 窗口内并发发业务请求（重启路径下前端事件仍在触发 hover/补全）。
  initialize 的 `1` 与 `NEXT_REQ_ID` 的起点 `1` 是同一数值，仅靠「init 先完成、会话才交付」
  的时序才不相撞。
- 坏法：`request.rs:88` `map.insert` **静默覆盖**同 id 条目 ⇒ 前一个等待者的 sender 被 drop ⇒
  立刻 `No response received`（进而触发 D2 的重启）；反向：`shutdown` 的 response 被投递给业务
  waiter（`result` 被当 hover 结果返回），关闭序列拿不到 ack ⇒ 白等满宽限再兜底 kill。
- 建议：所有出站请求（含 initialize / shutdown）走同一 allocator，并让 pending 键包含用途，
  或断言 `insert` 不覆盖已有键。

### D5 业务请求等待完全无界

- 位置：`session/request.rs:98-99` `rx.await`（无 `tokio::time::timeout`）。
- 条件：服务器活着但对某个方法沉默（jdtls 索引期不答 `definition`；RA 卡在一条长分析上）。
- 坏法：future 永不完成 ⇒ Tauri 命令永不 resolve（前端永远 loading）、pending 条目与
  `inflight` 桶永久占用；单飞桶的陈旧条目只能等「下一次同类请求」把它 cancel 掉，
  非单飞方法（definition 跳转 / references / formatting / codeAction）**永不回收**，
  唯一兜底是 reader 退出时的 `drain_pending`（进程必须死）。
- 建议：per-request deadline（客户端超时后摘 sender 并发 `$/cancelRequest`），
  与 `send_shutdown_request_bounded` 的看门狗同一不变量。

### D6 writer 写失败泄漏 pending 条目与 inflight 桶

- 位置：`session/request.rs:94` `writer.send(...).with_context(...)?`（`?` 早退）。
- 条件：writer 线程已因某次写错误返回（stdin 管道破裂，服务器半死）。
- 坏法：已 `insert` 的 sender 与已 `register` 的桶都不摘除 ⇒ 条目泄漏到会话结束；
  下一次同类探针 `register` 时把泄漏 id 当成「前一条在途」，向服务器发一条
  `$/cancelRequest` 指向一条早已失败的请求。
- 建议：`send` 失败走与成功等价的清理路径（`map.remove` + `tracker.complete`）。

### D7 `reopen_documents` 的数据被 `close_session` 自己清空 ⇒ 重放恒空转，且 ownership 守卫同时失效

- 位置：`session_store.rs:242-250`（`close_session` → `clear_open_documents(key)` +
  `editor_owned.remove(key)`）、`manager.rs:658`（新会话建好后才 `reopen_documents`）。
- 条件：任何 restart（状态栏崩溃重试 / Restart All / `java debug` 触发的 `lspRestartSession`）。
- 坏法：① 日志恒为 `re-opened 0 doc(s)` —— 重放机制是死代码；
  ② 更实际：`editor_owned` 一并清空 ⇒ 之后 `ensure_document_open` 认为「没有编辑器持有」⇒
  用**磁盘**文本给编辑器里未保存的文档代开 ⇒ 服务器按旧文本算出整体错位的诊断
  （正是该守卫存在的理由）。同时登记表的 text/version 只在 didOpen 时写入，`didChange` 不更新
  （`commands.rs:150-173`），即使重放修好，文本也是 didOpen 时刻的版本。
- 建议：close 前把待重放快照取出（或区分「停止」与「重启」的清理范围）；`didChange` 同步更新
  登记表文本/版本。

### D8 `lsp_open_document` 是 didOpen 的第二个出口

- 位置：`commands.rs:118-147`（`register_open_document` + 裸发 `textDocument/didOpen`），
  绕开 `LspManager::send_did_open`（唯一出口：重复先补 didClose）。
- 条件：任何调用（前端 wrapper `lspOpenDocument` 已存在，当前无调用点）。
- 坏法：与 `ensure_document_open` 已开的 v0 形成同一 uri **两条 didOpen** ⇒
  `duplicate DidOpenTextDocument`；或服务器按 vN 推诊断而客户端是 vM ⇒ 版本门整批丢弃 ⇒
  「Problems 有诊断、编辑器没波浪线」。与 `lsp-domain.md` 坑 5 的成文不变量直接冲突。
- 建议：命令体改走 `send_did_open`（或直接删除该死命令）。

### D9 `client/registerCapability` 无条件 ack，但 `didChangeWatchedFiles` 通道不存在

- 位置：`server_request.rs:38-40`（与 `unregisterCapability` 一起回 `null`）；
  全仓无 `didChangeWatchedFiles` 发送点。
- 条件：服务器动态注册 `workspace/didChangeWatchedFiles`（gopls 无条件注册；不看我们是否声明）。
- 坏法：客户端对**任何**注册都回「已生效」，服务器于是等永不出现的文件变更通知 ⇒
  agent 改盘（Neeko 的主要写路径）后 Problems 长期过期，直到某次请求恰好重算。
- 建议：要么接 watcher（最少按工作区根 glob 发批量 `didChangeWatchedFiles`），
  要么对 watchedFiles 注册回 `InvalidParams`/错误而不是 null（诚实失败优于假生效）。

### D10 progress `end` 直推 `ready`，绕过 lifecycle 单写点

- 位置：`session/notify.rs:124-131`（`Some("end")` → `transport.push_session_event(..., "ready", ...)`），
  不经 `publish_status` / 不判 `is_terminal()`。
- 条件：关闭 / 重启窗口内仍有排队的 `$/progress` end（jdtls 收尾时会集中发 end）。
- 坏法：相位已 `CLOSED` 之后前端仍收到 `ready` ⇒ chip 复活、诊断重新点亮，与
  「相位是唯一真相、事件是它的投影」冲突（该文件自己的不变量）。
- 建议：`end` 的 ready 事件经 lifecycle 门控（`is_terminal()` 则丢弃）。

### D11 退出预算被 2× 击穿（`close_all_sessions`）

- 位置：`manager.rs:1109-1124`：`budget = shutdown_grace.min(remaining)` 只切一次，
  `shutdown_and_exit_with` 内部 `send_shutdown_request_bounded(budget)` 之后
  `wait_exit(budget)` 又拿满额。
- 条件：java 会话对 `shutdown` 沉默。
- 坏法：预算 3s（`APP_QUIT_GRACE_BUDGET`）实际可拖到 ~6s；`deadline` 只在会话之间重算。
  注释宣称「按剩余时间切片」，与实现不符。
- 建议：进入序列时算一次绝对 deadline，两步共用同一 deadline。

### D12 `lsp_transport` / `lsp_request` 的返回载荷没有字节预算（红线 4）

- 位置：`commands.rs:467-580`（`lsp_transport` 把服务器响应 `serde_json::to_string` 直接返回）、
  `commands.rs:68-100`（`lsp_request` 返回裸 `Value`）。
- 条件：`textDocument/documentSymbol` / `semanticTokens/full` / 大 completion 响应
  （jdtls 大 Java 文件；semantic tokens 是整数数组，JSON 膨胀 ~6×）。
- 坏法：单次 IPC 明文 JSON 可轻易越过 2MB；`lsp_get_server_logs` 有 1.5MB 预算，
  主通道反而没有（differential）。
- 建议：与 `LSP_SERVER_LOGS_MAX_BYTES` 同口径封顶，或按需分页。

### D13 握手失败会发两条 error 事件（两个写者）

- 位置：reader 出口 `on_reader_exit`（`instance.rs` reader 闭包）+ `manager.rs:640`
  `emit_session_error`（装配失败路径）。
- 条件：服务器在握手期退出（mode ⑤/⑥）。
- 坏法：先 `"<server> exited unexpectedly | stderr: …"`（reader 判崩溃），
  再 `"LSP initialization: no response received | server stderr: …"`（manager 装配失败）⇒
  前端两条 error、两个重试入口、文案不一致（违反「终态单写者」的意图）。
- 建议：manager 侧先查该 key 的 lifecycle / 本次 attempt 是否已有终态文案，再决定是否补发。

### D14 `lsp_transport` 拦 `shutdown` 但放行 `exit`

- 位置：`commands.rs:506-513`（`shutdown` 直接回假 `result: null`，不转发）；
  通知分支不过滤（`exit` 会被原样转发给服务器）。
- 条件：前端按 LSP 规范先 `shutdown` 再 `exit`（当前 `@codemirror/lsp-client` 不发，属潜在）。
- 坏法：后端给假 ack，真 `exit` 透传 ⇒ 服务器退出而 lifecycle 未关闭 ⇒ 判成崩溃 + 触发重启。
- 建议：`shutdown`/`exit` 一并拦截（会话关闭只走 `shutdown_and_exit`）。

---

## 2. 已记录取舍（不报缺陷）

| 项 | 依据 |
|---|---|
| `workspace/applyEdit` 乐观 `applied:true`，不等前端 ack | `lsp-domain.md` §3 契约 2 |
| `drain_pending` 只在 reader 退出时兜底在途等待 | `lsp-domain.md` 原则 1「握手等待不得挂死」 |
| `get_server_logs` 1.5MB / 单条 4KB / 最新一条下界 | 同上「证据两侧都有界」 |
| `java/classFileContents` 不封顶（注释称远小于 2MB） | `commands.rs` 命令文档 |
| `server_capabilities` 只透传、不参与任何服务端行为门控 | 无假声明，属「不消费就不声明」的正确方向 |
| `snapshot` 的 `progress_pct` 恒 `None`（前端由 token 派生） | `status.rs` 注释 |

## 3. 可接受（附理由）

| 项 | 理由 |
|---|---|
| `inflight` 单飞语义（hover/completion/… 各自桶；`definition#probe` 独立桶） | 语义与测试一致；`complete` 只在仍为当前 id 时摘除，迟到完成不会误清 |
| 锁顺序 | 唯一嵌套是 `inflight → pending`（`request.rs:79/26`），无反向路径；`Lifecycle` 的 `message` 锁不与 `sessions` 锁成环 |
| `request.rs:26/79/87/108` 的 `expect("infallible")` | 当前无「持锁 panic」源 ⇒ 不可达；但与 reader 侧刻意避免 `?` 早退的策略不一致，一旦成立即整条请求路径 panic 而非降级 |
| 服务端主动请求应答完整性 | 白名单 + `MethodNotFound` 兜底，**每条**都有应答（含畸形载荷），不会让服务器阻塞 |
| `initialize` 失败路径的进程收尾 | kill → join stderr → 证据内联 → `Err`；`LspProcess::drop` 再兜一次，无孤儿 |
| `initialized` 时序 | 在 init response 之后发送，符合规范 |

---

## 4. 未覆盖 / 需要更多证据

- 前端是否对 `lsp_transport` 自行加超时（`tauriLspTransport.send` 无超时；若 codemirror 侧也无则 D5 直接表现为 UI 永久 loading）。
- jdtls 撞 `-data` 锁时的真实 stderr 形态（用于把 D3 的失败文案做成可判据，而非泛泛「no response」）。
