# 审计：LSP 会话装配与编排层

范围：`manager.rs` / `session_store.rs` / `plugin_manager.rs` / `plugin/registry.rs` / `profile.rs` /
`spawn_spec.rs` / `installer.rs` / `plugin/types.rs` / `plugin/builtins/*` / `attempt_diagnostics.rs` /
`diag_bus.rs` / `log_ring_buffer.rs`（编排与归属）/ `commands.rs`（命令层厚度）。
**不重审**：进程 kill 与关闭序列本体（11-12 已修）、请求通道细节（另两位审计员）；不报告已既定项
（jdtls `-data` 归属、`.metadata/.log` 文案、`lsp-domain.md` 已记录的有意决策）。

日期：2026-11-13。只读审计，未改任何代码。

---

## 1. `send_request_with_policy` 的"重启"既不重启也不该按错误计数

**位置**：`src-tauri/src/lsp/manager.rs:754-838`（判定 805、递增 833、退避 812-821）

**机制**

1. `do_send_request` 返回 `Err` 的三种来源：① 写通道失败/会话已死；② 服务器回 **error response**
   （除 `RequestCanceled` 外全部 `bail!("LSP error ({code}): …")`，见 `session/request.rs:118-126`）；
   ③ pending 发送端被摘除。
2. `RequestPolicy::RestartOnFailure` 对②③一视同仁 → 打印 `Will restart` → 走"重启路径"。
3. 重启路径先 `get_or_create_session`，而它**快路径直接 `is_alive` 返回**（`manager.rs:550`）：
   会话活着 → 根本没有重建 → 只是把请求重发一遍给同一个会话。
4. 随后 `increment_restart(&key)` 无条件递增；**成功路径从不清零**（`clear_restart` 全仓唯一调用点是
   `session_store.close_session`，`session_store.rs:245`）。

**什么条件下坏**

- 服务器对任何一次请求回普通错误（rust-analyzer 的 `ContentModified`/`-32801` 在编辑中极常见、
  gopls 的 `no views`、jdtls 的瞬时错误）→ 计数 +1，会话没被重启（它本来也该活着）。
- 累计 5 次（**跨请求、跨天、不需要真故障**）→ `prev_count >= MAX_RESTART_COUNT` →
  该 `project:language` 的**所有**请求恒返回 `Max restart count (5) exceeded`。
  但会话仍在、chip 仍显 Running、无任何"重试"入口（前端只在 `status=error` 时给重试按钮）→
  用户看到"跳转失败 / 补全失败"，LSP 面板却一切正常，只能手工 Restart/Stop 才能恢复。
- 副作用放大：`prev_count>0` 时每次失败都先睡 `500ms * 2^prev`（1s→8s）才重发，短暂错误风暴后
  连续多个请求被拖慢数秒。

**建议**：把"会话是否需要重建"与"请求是否失败"解耦 —— 只有通道不可用（writer 发送失败、
pending 被摘、会话 `is_terminal`）才进重建路径；error response 原样上抛。计数改为"失败streak"：
成功清零，且只统计**重建尝试**。

---

## 2. 重启（替换）清掉了 open_docs 与 editor_owned —— 与"替换语义"相反

**位置**：`manager.rs:891-923`（`close_session_for_restart` → `take_for_close`）→
`session_store.rs:242-252`（`close_session` 同时 `clear_open_documents` + `editor_owned.remove`）

**机制**：`take_for_close` 是"关闭"与"重启"的共用实现，它按**关闭**语义清理：文档登记表、重启计数、
编辑器持有表全部删除。而 `get_or_create_session` 的文档回放（`manager.rs:648-670`
`reopen_documents`）恰恰依赖 `open_docs`。

**什么条件下坏**

1. 磁盘回放不可达：`lsp_restart_session` / `lsp_restart_all_sessions` / 状态栏"重试"（崩溃后最常用）
   走 `close_session_for_restart` → `open_docs` 清空 → 新会话 `re-opened 0 doc(s)`。
   对照：进程崩溃后由请求失败触发的重建**不清** `open_docs`，回放生效 —— 两条重建路径行为不一致。
2. 编辑器持有权丢失：前端 `documentOwnership` 的引用计数绑定**文件 tab 生命周期**
   （`src/features/editor/hooks/useLspClient.ts:80-90`），后端重启不重挂视图 → 不会重新 claim。
   后端 `editor_owned` 已空 → 下一次 hover/definition 走 `document_open::ensure_document_open` →
   `needs_backend_open(uri, false, false) == true` → **读磁盘文本代开**。
   - 未保存缓冲区 → 服务器副本 = 磁盘旧文本（`next_open_version(None)=0`）；
   - 编辑器客户端仍按自己的版本钟继续发 `didChange`（服务端接受并叠加到磁盘副本上）→ 副本静默分叉；
   - 诊断坐标与 quickfix 编辑落在错行（正是 `lsp-domain.md` §7.5 记录的 2026-09-21 事故形态）。

**建议**：`take_for_close` 加 `SessionCloseNotice` 维度：`Silent`（替换）保留 `open_docs` 与
`editor_owned`，仅落终态；重启后由 manager 主动回放并**不**清持有权。加护栏测试：
"restart keeps open documents and editor ownership"。

---

## 3. 创建走 per-key 门，关闭/重启不走同一把门

**位置**：`manager.rs:532-541`（`creation_gate`，仅 `get_or_create_session` 使用）vs
`manager.rs:891-936`（两条关闭入口完全不碰 gate）

**什么条件下坏**

1. **Stop 被静默丢失**：装配进行中（`check_plugin_installed` → 自动安装 → `--version` 探测 →
   initialize 握手，jdtls 安装可达分钟级）用户点 Stop：`session_store.close_session` 找不到 key →
   返回 `Ok(())`，前端把 chip 移除。装配随后成功 → `insert` → 会话存在但前端不知道，下一次请求又把它
   拉起来，chip 重新变 Running。用户视角："停止无效"。
2. **重启与旧进程抢 workspace 锁**：`close_session_for_restart` 先把会话从 store 摘除，再 `await`
   关闭序列。此刻编辑器任何 `didChange`/`didOpen`（`lsp_transport` 每条消息都先
   `ensure_session_async`）→ 慢路径 → 新会话在旧进程尚未退出时创建 → 两个 jdtls 抢同一 `-data`
   锁，新会话 initialize 无响应。该入口"必须 await 收口"的设计前提（单一调用方）不成立。
3. `close_sessions_for_project`（停用定时器）同理：快照语言列表后并发创建不被阻止。

**建议**：把「一个 key 当前是否有会话在装配/关闭」收进同一把门（重启 = 持门 → 关闭 → 创建），
或给 key 加 `Restarting` 相位让并发创建等到收口结束。

---

## 4. `remove_project` 不拆除 LSP 侧状态

**位置**：`src-tauri/src/project/commands.rs:32-57`（只调 terminal_router / watcher_manager）

`remove_project` 完全不触碰 `lsp_manager`：不 `close_sessions_for_project`、不 `evict_project`、不
`profiles.remove`、不 `cancel_deactivate`。

**什么条件下坏**

- 删除项目 → 其 `rust-analyzer` / jdtls 进程活到应用退出（jdtls = 一整个 JVM + workspace 锁，
  RA 常见 GB 级 RSS）。停用定时器只对"被切走的**上一个激活项目**"设置（`project/commands.rs:150`），
  删除的项目永远等不到。
- 同路径重新添加（很常见的"删了重新加"操作，用于换 environment / 换根）：会话 key =
  `path:language` 不变 → `is_alive` 快路径**直接复用旧进程**。旧进程跑在旧 `ExecTarget`（Local vs
  WSL/SSH）与旧会话根上，而 `bind_project_exec_target` 已把新环境写进 map → 探测/新会话用新环境、
  活着的那个用旧环境（P2「同环境」在会话生命周期维度被破坏）。
- `attempt_diag` 条目与 `preauth` 桶同样残留（前者靠 `evict_project`，后者无驱逐点）。

**建议**：`remove_project` 复用停用拆解路径（关闭 + `evict_project` + `profiles.remove`），并把
"exec target 变化"作为会话失效条件（对比当前 target，不同则重建）。

---

## 5. 非 Local 目标：安装产物不在可用性判据的 PATH 里 → 每次会话创建全量重装

**位置**：`installer.rs:110-121`（`check_plugin_installed` → `check_binary_installed` →
`core/exec.rs:215`）+ `plugin/builtins/java_install.rs:26-56`（脚本产物 `$HOME/.neeko/bin/jdtls`）+
`session/instance.rs:127-146`（门 + 装后复检）

**机制**：`Local` 的二进制解析走 `exec_env::local_command_exists` → `host_user_path()`，而进程启动时
`exec_env` 已把 `~/.neeko/bin` **置顶**进 PATH（`core/exec_env.rs:34-41`）。`Wsl`/`Remote` 走
`run_script(target, "command -v <bin>")` —— 远端 login PATH，**没有**任何 `~/.neeko/bin` 置顶；
而安装脚本 `run_command_streaming(ctx, …)` 在远端执行、产物落在远端 `$HOME/.neeko/bin`。

**什么条件下坏**（WSL/SSH 项目 + Java）

1. `check_plugin_installed` → false（远端 PATH 无 jdtls，即使上一轮已装好）→ 每次都跑安装链；
2. 安装链成功（脚本 exit 0）→ 装后复检仍 false → `bail!("… was installed but still not found in
   project PATH. Try restarting Neeko.")`；
3. 用户按提示重启 Neeko → 回到第 1 步 → **每轮重下 ~100MB**，永远起不来。文案还指导用户做无效动作。

这就是 P2 原则的反例：判据（远端 `command -v`）与产物位置（远端 `$HOME/.neeko/bin`）不同环境，
且只有 Local 分支做了 PATH 置顶。

**建议**：把 `~/.neeko/bin` 置顶做成 target 无关的 exec env 组成（`LspExecContext.env` 或远端
shell 前缀），或让判据直接检查该绝对路径（`exists && executable`）—— 判据与消费点必须同源。

---

## 6. 自动安装跑在会话创建的同步关键路径上（超出调用方预算）

**位置**：`session/instance.rs:127-160`（`LspSession::new` 内部同步安装）→ 被
`manager.rs:542` 慢路径（gate 内）调用 → 被 `commands.rs` 的 `ensure_session_async`（await）与
`lsp_transport` 阻塞。

**什么条件下坏**

- 首次打开 `.ts` 而 `typescript-language-server` 缺失：`npm install -g` 常 30–120s。前端
  `@codemirror/lsp-client` 的 `initialize` 请求按 `request_timeout_ms`（TS 家族未声明 → 通用默认
  15s）先超时 → 用户看到"LSP 启动失败"；install 仍在后台继续，下次重试才成功。
  `lsp_request`/`go_to_definition` 同理被拖住整个安装时长。
- 安装期间该 key 的 gate 被占（并发的同 key 请求全部排队），`lsp_list_sessions` 外的一切都慢。

**建议**：把自动安装从装配路径移出（项目激活 / 首次发现缺二进制时预装，事件已支持进度），
或让装配失败返回 `installInProgress` 让调用方等待而不是占用请求预算。

---

## 7. `INSTALL_IN_PROGRESS` 只按 `language_id` 全局去重

**位置**：`installer.rs:20-31,125-152`

**什么条件下坏**：项目 A（Local）与项目 B（WSL，或另一个 npm 前缀）同时需要同一语言的服务器 →
B 的 `install_plugin_server` 命中 `contains(language_id)` → `Err("Install already in progress")` →
`instance.rs:143-150` 包装成 `Failed to auto-install <bin>. Install it manually: Install already in
progress`。即：**别人的安装把本项目判成安装失败**，文案与真实原因无关；B 必须等 A 装完再手工重试
（而 A 装好的东西 B 未必能用 —— 不同 target 是两个环境）。

**建议**：键改 `(language_id, target)`（跨 target 本就该并行），同键改为**等待**同一 future 而不是
返回错误；至少文案要说明"另一个项目正在安装"。

---

## 8. 握手失败存在两个终态写者（重复 error 事件 + outcome 非确定）

**位置**：`session/instance.rs:480-500`（initialize 失败的 `Err`）与 `instance.rs:791-808`
（reader 线程 `on_reader_exit`）→ `manager.rs:634-646`（装配失败 `record_failure` + `emit_session_error`）

**机制**：子进程在 `initialize` 期间退出时，reader 线程先 `drain_pending`（让握手方失败）并**紧接着**
`on_reader_exit` → `lifecycle.on_reader_exit` 首次判崩溃 → `diagnostics.record_failure(crash_message)` +
`emit_session_error("… exited unexpectedly | stderr: …")`。装配方随后也 `record_failure(manager 的文案)`
+ `emit_session_error("LSP initialization: no response received | server stderr: …")`。

**什么条件下坏**（服务器启动后立刻退出：`rust-toolchain.toml` 缺组件、jdtls `Application error`、
缺 JDK）

- 前端同一 `project:language` 收到**两条不同文案**的 `error` 事件（对应 `lsp-domain.md` 里保留的
  现场日志："jdtls exited unexpectedly | stderr: WARNING…" 与 "… no response received" 同时出现）；
- `get_server_info().outcome` / View logs 的"失败原因"取决于两个线程的写序（last-writer-wins）→
  同一故障两次复现可能给出不同原因；
- `record_failure` 各推一行日志 → 同一个失败在 View logs 里出现两条不同 message。

这与已记录的"终态单写者/不得两处各推一遍"契约直接冲突 —— 契约只覆盖了"同一消息"，没覆盖
"reader 崩溃 + 装配失败"这一组合。

**建议**：装配期（`LspSession::new` 尚未返回成功）内 reader 不得写该键终态（例如先 `begin` 一个
"装配中"门：只在会话成功交给 manager 后才允许 reader 落账），或由 manager 在装配失败时**覆盖式**
落账并抑制 reader 的重复事件（`emit` 一次，log 一次）。

---

## 9. 文档定根（`RootScope::DocumentScoped`）不进会话身份

**位置**：`manager.rs:616-621`（只在慢路径算 `workspace_root`）+ `manager.rs:120`（`session_key` =
`project:language`）+ `session/root.rs:47-110`

**什么条件下坏**（monorepo：`frontend/` 与 `admin/` 各自有 `package.json` + 自己的 `node_modules`）

1. 先打开 `frontend/a.ts` → 会话根 = `frontend/`（正确）；
2. 再打开 `admin/b.ts` → key 相同 → `is_alive` 快路径返回 → **沿用 `frontend/` 根**；
   `typescript-language-server` 从 `frontend/` 向上解析 `node_modules/typescript` →
   `admin/` 的依赖全部解析失败（未解析 import 红波浪线、无补全、跨包跳转失效）。
3. 反向也一样：谁先打开谁决定整个项目的根；重启（无 document）走的是
   `scan_project_for_root_markers` BFS（`MAX_SCAN_DEPTH=4`）→ 可能落到**第三个**目录，与会话实际根不一致。
4. 前端没有任何手段发现这种错配：`LspSessionInfo` 不含 root，`get_server_info` 也不含。

**建议**：会话 key 加上会话根（`project:language:root`），或至少在同 key 命中时比较
`resolve_session_root` 与现存会话的根，不一致则按"重启"换根（后者要配 §2 的保状态语义）。

---

## 10. `lsp_open_document` 绕过 didOpen 唯一出口

**位置**：`commands.rs:118-152`（自拼 params → `send_notification("textDocument/didOpen")`；
且**先** `register_open_document` 后发送）

对照：`manager.rs:438-505` `send_did_open` 是文档化的唯一出口（重复先补 `didClose`、登记后置、
版本回退识别），`document_open::ensure_document_open` 与 `lsp_transport` 都走它。

**什么条件下坏**（IPC 层可达；前端 `lspOpenDocument`（`src/features/lsp/api/lspApi.ts:47`）已导出，
当前无调用点 → **潜伏**，任何一次启用/复用即触发）

- 同一 uri 第二次打开不发 `didClose` → rust-analyzer `duplicate DidOpenTextDocument`，该文件停止分析；
- 版本回退（后端曾以 v3 打开、编辑器以 v0 重开）无告警、无归一 → 服务器/客户端版本钟分叉，
  `@codemirror/lsp-client` 版本门整批丢诊断（`lsp-domain.md` §7.5）；
- 发送失败仍已登记 → 服务器没打开、登记表说打开了 → 后续 `ensure_document_open` 短路（`already_open`）
  → 该文件永久无诊断。

**建议**：删除该命令（或改为 `send_did_open` 委托），并在 CI 加一条 grep 护栏：
`didOpen` 字面量只允许出现在 `manager.rs::send_did_open` 与 `session` 的回放路径。

---

## 11. 命令层厚度（红线 6）

**位置**：`commands.rs:582-665`（`lsp_go_to_definition`，~84 行非测试源码）

命令体内做了：三段 perf 计时、`document_open::ensure_document_open` 调度、definition 响应解析
（`UnifiedLocation`）、**preauth 记账**（安全相关）、目标文件预读（512KB 策略、`jdt://` 短路）、
IPC 载荷拼装（`definition_response`）。命令层应"只校验 + 调度"，这些属于 LSP 域业务。

**什么条件下坏**：这段逻辑无法在无 Tauri 运行时下单测（`State<'_, AppStateWrapper>` 具象依赖），
新增"跳转到符号（workspace/symbol 结果）"或"跳转后预读"调用方时必然复制预授权 + 预读 + 载荷三件套
（当前 `lsp_read_preauthorized_file` 已经与它共享同一套 preauth 语义，属于两处维护）。

**建议**：把 `definition → target uris → preauth → 预读 → response` 收进 `manager`/services 层纯异步
函数，命令只剩参数透传（`lsp_read_class_file_contents` 已是这个形态，可作为模板）。

---

## 12. 同一 server 二进制按 `language_id` 建多个会话（重复装配）

**位置**：`plugin/builtins/typescript_family.rs:18-45`（typescript / typescriptreact / javascript /
javascriptreact 共用 `typescript-language-server --stdio`）+ `manager.rs:120` 会话身份

**什么条件下坏**（任何 React+TS 工程，`.ts` 与 `.tsx` 同时打开）

- 两条会话 key = 2 个 `typescript-language-server` 进程：各自 `--version` 探测、各自 initialize、
  各自 tsserver 项目索引（内存/CPU 翻倍，大工程可达数百 MB）；
- 前端 `acquireLspPlugin` 也按 `(projectPath, languageId)` 分实例，于是同一工程有 2 个 client、
  2 条诊断事件流；`.ts` 里 jump 到 `.tsx` 目标由 A 会话完成，B 会话并不知道该文档"已打开"
  （每个服务器各自读盘，功能上不出错，但 `workspace/*` 级请求被拆成两份）。
- 对照 VS Code 模型：一个 server 实例 + `documentSelector` 覆盖 4 种 languageId。

**建议**：给 `LspPlugin` 加"服务身份"（binary + root 或显式 `server_id`），会话 key 用它而不是
languageId；languageId 只作为 `didOpen` 载荷字段。属于结构性改动，需单独立项。

---

## 可接受 / 已记录取舍（逐条回答审计提纲）

| 提纲问题 | 结论 | 依据 |
| --- | --- | --- |
| `creation_locks` 跨 await 持有是否死锁 | **不成立**：guard 在 `spawn_blocking` 闭包内部，从未跨 `.await`；`parking_lot` 无 poison，无重入路径（`LspSession::new` 不回查 manager）。唯一代价是被安装/握手长期占用同一 key（见 §6） | `manager.rs:532-541,559-566` |
| 快路径 `is_alive` 与慢路径生代隔离缝隙 | 生代隔离本身严密（`begin` 只在慢路径、写只走句柄）。缝隙在**身份**而非生代：快路径不复核装配参数（root / exec target），见 §2 §9 | `manager.rs:550,575`、`attempt_diagnostics.rs:121-130` |
| `profiles` 缓存与失效 | 检测/压制/缓存均数据驱动且无语言名（`profile.rs` 全文件零语言分支，单测覆盖自定义插件压制）。失效点只有 `close_sessions_for_project`；`remove_project` 不触发（§4）；marker 变更需重新 activate（前端有入口）→ 可接受 | `manager.rs:972-976`、`profile.rs:74-108` |
| `schedule_deactivate` 与 profile 生命周期 | 代次计数器 + `cancel_deactivate` 在 `activate_project` 内（正确顺序：先取消再检测再 emit）。残余竞态：定时器"读代次 → 关闭"非原子，若恰在此窗口重新激活并建会话会被误关（30 分钟延迟下实际不可观测）→ 记录风险，不修 | `manager.rs:984-1014,1038-1041` |
| `attempt_diagnostics` 终态覆盖 | 插件缺失 / exec target / transport / build 失败均有 `record_failure`（`manager.rs:584-612,639`）；进程秒退由 reader 的 `on_reader_exit` 落账；唯一缺口是握手期双写者（§8） | 同上 |
| `--version` 探测与 `version_probe` 数据 | 形态分类（`Answered` / `Refused` / `Weak` / `NotRunnable`）不按语言分支，`NotRunnable` 直接失败（真实启动必以同错失败）；jdtls 用数据关闭探测。与可用性门控（`check_plugin_installed`）职责分离且已记录为有意决策 → 无新增缺陷。附带成本：同二进制多 language_id 会重复探测（§12） | `session/instance.rs:170-205`、`process.rs::classify_probe_run` |
| `diagnostic bus` 归属 | 事件带 `project_path + uri + version`，前端按 project 分流；`set_app_handle` 的 `mem::forget` 保证订阅不死（唯一调用点 `boot.rs:24`，重复调用才会双推 → 现不可达） | `diag_bus.rs`、`manager.rs:511-528` |
| `mod.rs` 厚度 / 平台差异 | `lsp/mod.rs` 49 行纯声明与 re-export；平台差异已落 `platform/file_url`、`platform/shell_launch`、`core/exec_env`，通用模块无 `#[cfg]` | `lsp/mod.rs`、`session/root.rs:172-176` |
| 行数台账 | `lsp-domain.md:192` 只登记了 `types.rs`（豁免）与 `instance.rs`。实际非测试源码：`manager.rs` 1219、`commands.rs` 792、`process.rs` 981、`instance.rs` 987 均 >300 且未登记。唯一"确实导致问题"的实例：`manager.rs:1200` `language_for_path` 与 `resolve_language_for_path`（`plugin_manager.rs:27`）是同一知识两份实现 —— 前者现造 `with_defaults()` registry，自定义插件对其不可见（当前仅测试调用 → 潜伏陷阱）。建议删除或委托 | `wc -l` + `#[cfg(test)]` 行号 |

## 未发现问题的项（供交叉核对）

- `session_store` 的文档登记（同 uri 去重、编辑器持有 refcount 语义、"清登记不动所有权"）与单测一致。
- `plugin_manager::apply_settings` 的 `reset_to_defaults + 重注册`顺序正确（不会丢失内置插件）。
- `activate_project` 里"文档定根插件不预热"的判据取自插件数据（`root_scope.walk_markers()`），
  无语言名分支，符合红线 15。
- `installer` 的 `InstallLog` 尾部窗口 / 节流 / UTF-8 边界切分有护栏测试，与 IPC 2MB 红线一致。
- `attempt_diagnostics` 的 `evict_project` 用条目自持 `project_path` 精确匹配（不做前缀），
  含 `:` 的 POSIX 路径不会误伤。

## 建议修复顺序（成本 / 收益）

1. §1（重启语义 + 计数）—— 单点改动，消除"永久不可用"这一类最伤用户的故障。
2. §8（双写者）—— 抑制重复 error 事件，恢复"终态单写者"契约。
3. §2（重启保状态）+ §3（关闭/重启同门）—— 同一处代码，一起改。
4. §4（remove_project 拆除）—— 明确的生命周期缺口，低风险。
5. §5 / §6 / §7（安装器三连）—— 判据与环境同源 + 移出关键路径 + 并发键。
6. §10 / §11（命令层）—— 删除旁路 + 下沉业务。
7. §9 / §12（会话身份）—— 结构性，需单独立项（会话 key 变更会牵动前端 store 与事件通道）。
