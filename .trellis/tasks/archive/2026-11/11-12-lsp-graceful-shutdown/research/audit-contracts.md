# LSP 域：跨端契约与资源边界审计

> 审计范围：`src-tauri/src/lsp/**`（types/commands/transport/diag_bus/session/*）+ `src/features/lsp/**` +
> `src/shared/events.ts` + `src/features/editor/hooks/useLspClient.ts` + `src/shared/store/`（确认无 LSP 切片）。
> 既定不报：刚修完的关闭序列（Rust 侧）、`-data` 归属、`.metadata/.log` 文案。
> 记录为「已记录取舍」的 spec 决策（波浪线模型 / 导入策略三态 / Problems 性能 / didOpen 唯一出口 /
> 能力声明一致）不算缺陷 —— 但凡**代码已与该决策漂移**，判为缺陷。
> 只审计，未改任何代码。

## 结论表（按严重度）

| # | 位置(file:line) | 问题 | 判据（什么条件下坏、坏成什么样） | 建议 | 类别 |
|---|---|---|---|---|---|
| 1 | `src/features/lsp/store/lspStore.ts:468-475`、`src/features/settings/components/LspPanel.tsx:36-43` | 两处 `lspGetExtensionMap()` → `applyBackendExtensionMap()` 的 map 都只搬运 4 个字段，**丢掉 `requestTimeoutMs`** | `applyBackendExtensionMap`（`languageMap.ts:92`）每次都先 `clear()` 再写；字段恒缺 ⇒ `requestTimeoutMsByLanguage` 永远为空 ⇒ `lspClientTimeout()`（`lspClientManager.ts:71`）恒返回 15s。java/rust 插件声明的 `120_000`（`java.rs:61`、`rust_lang.rs:42`）从未生效：jdtls 冷启动、RA 首次 `hir_ty::infer`（实测 95-98s）都会在 15s 抛 `Request timed out`。spec「冷启动就绪语义」第 3 条明写这条消费链，属**代码与已记录决策漂移**；现有护栏（`languageMap.test.ts:41`、`lspClientManager.test.ts:70`）直接调 `applyBackendExtensionMap({...requestTimeoutMs})`，绕过了被破坏的 mapper，故全绿 | 在 `lspApi.ts` 里把「DTO → `LspExtensionMapEntry`」收敛成一个映射函数（不丢字段），两处调用它；或直接 `map(e => ({...e}))` 透传 | 真缺陷 |
| 2 | `src-tauri/src/lsp/session_store.rs:238-252`（`close_session` 里 `clear_open_documents` + `editor_owned.remove`）、`manager.rs:645-670`（`reopen_documents`） | 重启关闭把 didOpen 登记表与**编辑器所有权**一起清掉；新会话的 `reopen_documents` 遍历的是空表 ⇒ 0 条 didOpen 重放 | 状态栏 Restart / 崩溃重试后：① 服务器端该文档已消失，编辑器不会重发 didOpen（`useLspClient` 的 effect deps 不含会话状态）⇒ 无诊断、无补全上下文，直到用户**编辑**（didChange 才带回分析）；② 期间任何 `lsp_request`/`lsp_go_to_definition` → `needs_backend_open(uri, already_open=false, editor_owned=false)`=true → 按**磁盘文本**代开（`document_open.rs:46`）⇒ 未保存缓冲区坐标错位（spec §7.5 记录的事故形态）；③ 代开用 `next_open_version(None)=0`，而 lsp-client 手里是 v42 ⇒ 服务器推送被版本门整批丢弃 | 重启路径不要 `clear_open_documents`/`editor_owned`（只摘会话对象）；或新会话建立后按登记表 `send_did_open` 重放，并保留 claim 表 | 真缺陷 |
| 3 | `src/features/lsp/store/lspStore.ts:365-370` | 会话边界 `clearProjectDiagnostics(projectPath)` 是**项目粒度**，而会话边界由单一 languageId 触发 | 混合语言项目（同仓 rust+java）：点 Java 的 Restart（`useLspServerActions.ts:37-43` 乐观写 `starting`）或 Java 崩溃 → Rust 的既有诊断被整块清掉；服务器不会重推未变更文件 ⇒ Rust 波浪线/Problems 条目永久消失，直到对应文件被编辑。诊断事件本身无 `languageId`（`transport.rs:104-112`）故无法分流 | 诊断切片按 `languageId` 分区（事件补 `languageId`，`diag_bus` 已持有该字段），清边界只清该语言 | 真缺陷 |
| 4 | `src/features/lsp/transport/tauriLspTransport.ts:186-196` vs `src-tauri/src/lsp/transport.rs:126-133` | `$/progress` 载荷契约两端形态不一致：后端发**扁平** `{languageId, token, kind, message, percentage}`，前端按 `{token, value:{kind,…}}` 读并转发 `params: { token, value: event.payload.value }` | `event.payload.value` 恒为 `undefined` ⇒ `JSON.stringify` 丢掉该键 ⇒ 转发给 lsp-client 的 `$/progress` 只有 `token`。当前 `@codemirror/lsp-client` 无 `$/progress` 消费点（dist 内零命中）故无可见症状；一旦补上消费点（或升级库/补丁开始读 `params.value.kind`）即 `undefined.kind` 抛错。附带：同一事件被 `lspStore.ts:392` 与每个 transport 各挂一个监听（每 client 一份重复订阅） | 前端按后端实际形态读 `{token, kind, message, percentage}` 再拼 `value`；若无消费点就删掉这个监听 | 真缺陷 |
| 5 | `src-tauri/src/lsp/commands.rs:118-148`（`lsp_open_document`）+ `commands.rs:150/176`、`api/lspApi.ts:59-99` | 存在**第四条** didOpen 出口：`register_open_document` + 裸 `send_notification("textDocument/didOpen")`，绕过唯一出口 `send_did_open`（无「重复先补 didClose」归一、不走 `next_open_version`）。且 `lspOpenDocument/lspChangeDocument/lspCloseDocument` 前端**零调用**（死 IPC 面） | 只要有任何调用方接上这三个命令：同一 uri 第二条 didOpen → rust-analyzer `duplicate DidOpenTextDocument`，版本分叉 → 版本门丢弃推送（spec §7.5 的完整事故链）。即「已记录的 didOpen 唯一出口决策」在命令层被漂移 | 删除这三个命令与 api（无消费点），或让 `lsp_open_document` 走 `send_did_open` | 真缺陷 |
| 6 | `src-tauri/src/lsp/commands.rs:68-108`（`lsp_request`）、`commands.rs:467-573`（`lsp_transport`） | 原样返回服务器响应，**无 2MB 预算、无截断/分页**；对比 `lsp_get_server_logs` 有 1.5MB 双预算（`manager.rs:79`）、`lsp_go_to_definition` 预读封 512KB | 红线 4 未落实在该通道：`textDocument/references` 在大仓上万条 Location（≈1.2MB+）、`documentSymbol`（生成代码）、带 `documentation: true` 的 `completion` 列表都可能单次 >2MB → 一次 `invoke` 全量 JSON 序列化 + 跨进程拷贝，主线程卡顿/内存尖峰，且无降级路径 | 对这两个命令统一加响应字节预算（超限返回明确错误 + 前端分页/请求收窄），或走二进制流 | 真缺陷 |
| 7 | `src-tauri/src/lsp/session/instance.rs:895` | `build_client_capabilities()` 声明 `publishDiagnostics.relatedInformation: true`，但 `src/` 全仓 grep `relatedInformation` **零命中**（无渲染、无解析） | 红线 14（声明必须有消费点）：服务器据此在每条 publish 里塞 relatedInformation（jdtls/ts 常见），诊断事件载荷按条膨胀却永不显示 —— 纯 IPC/内存成本；同时这是「消费者不存在」的假声明 | 删掉该声明，或让 `DiagnosticRow`/`lspQuickFixPopup` 渲染相关位置 | 真缺陷 |
| 8 | `src-tauri/src/lsp/session/notify.rs:89,122`（另 `:293-320` serverStatus）、`session/status.rs:9-13`、`session/lifecycle.rs:45` | `indexing` 用**字面量**直推 transport，不推进 `lifecycle`；`status.rs` 注释断言「服务端不会发出该状态」、`lifecycle.rs::set_indexing_normalizes_to_ready` (`:321`) 断言 `Indexing→READY`；`types.rs:28-38` 的 `session_events` 常量（STARTING/READY/ERROR/STOPPED）全仓零引用 | ① 注释与实现互相矛盾（同一事实两份记录）；② `lsp_list_sessions`/`snapshot()`（`instance.rs:726-745`，读 lifecycle）在导入期返回 `ready`，与事件流的 `indexing` 不同源 ⇒ 重订阅（切项目来回）后 chip 靠 `LspStatusSection.tsx:77-80` 的 token 兜底仍显示 Indexing，但子菜单行 `LspServerRow` 圆点与 `formatInfoFooter` 显示 Running；③ 状态词表没有单一来源，改名只改一端不会被任何测试发现 | `notify.rs` 改调 `publish_status(..., LspSessionStatus::Indexing, ...)`（或删掉 `Indexing` 变体并同步注释）；`session_events` 常量接线或删除 | 真缺陷 |
| 9 | `src-tauri/src/lsp/session/instance.rs:831-845` | `await_init_response` 只处理「reader 已死」，`blocking_recv` **无 deadline** | 服务器存活但永不应答 `initialize`（jdtls 卡在 workspace 锁、代理/网络挂起）⇒ `spawn_blocking` 线程永久占用，且该 key 的 creation gate（`manager.rs:532`，`parking_lot::Mutex`）一直被持有 ⇒ 该 project+language 的**所有** LSP 命令永久挂起，前端每条 invoke 永不 settle（前端 timeout 只管已连接后的 client 请求） | 给握手加有界 deadline（会话宽限同源），超时 `kill + record_failure`，与「no response received」文案复用 | 真缺陷 |
| 10 | `src-tauri/src/lsp/types.rs:211-231`（`event_names_match_frontend_mirror`） | 该测试名/注释声称锁定「前端 mirror」，实际只断言 Rust 常量 == **同文件内硬编码字面量**，从不读取 `src/shared/events.ts` | 红线 5 的执行侧缺口：改前端任一 `LSP_*` 常量（或改 Rust 常量并顺手改该断言）→ CI 全绿 → 前端 `listen` 静默失联，正是 `LSP_PROGRESS_EVENT_PREFIX` 曾写成 `lsp-project-` 的事故形态。仓库已有正确范式：`src/shared/__tests__/sessionsEventConstant.test.ts` 反向读后端源码逐字比较 | 照 `sessionsEventConstant.test.ts` 形态加一条读 `lsp/types.rs` 的跨栈断言（或反向：Rust 侧读 TS 文件） | 真缺陷 |
| 11 | `src/features/lsp/transport/tauriLspTransport.ts:177-180,196-199,215-218` vs `:226-240` | 三个 `listen().then(u => this.unlistenX = u)` 的注销依赖**赋值先于 destroy**；`destroy()` 只注销「已赋值」的句柄 | `destroy()` 若早于 `listen()` promise resolve（HMR dispose、`__resetLspClientPoolForTests`、将来把 `LSP_CLIENT_IDLE_DESTROY_MS` 调小）⇒ 三个 Tauri 监听器永久泄漏，且没有任何后续代码持有它们（bundle 已离开 pool）⇒ 每 project+language 泄漏 3 个监听器，事件回调被清空的 `handlers` 吞掉但订阅数单调增长 | `listen()` 前先置 `destroyed` 哨兵，resolve 时检查 `destroyed` 并立即 `safeUnlisten` | 真缺陷 |
| 12 | `src/features/status-bar/bridges/LspSubscriptionBridge.tsx:39`、`src-tauri/src/lsp/types.rs:46-66` | `s.status as LspSessionState['status']` 把后端自由字符串**强转**进前端 union；`LspSessionInfo.status` 的 Rust 注释只列 `starting, ready, error`（实际六态：多 `initializing/indexing/stopped`）；`LspSessionInfo` 是全仓 LSP 里唯一 **snake_case** DTO（其余 `#[serde(rename_all="camelCase")]`） | 后端新增/改名状态值（如 `shutting-down`）→ TS union 静默接受 → `BUSY_STATUS`/`TERMINAL_STATUS` 均未命中 → chip 显示裸服务器名、诊断不清 ⇒ 类型漂移无编译/运行告警。snake_case 差异使 `s.server_name` 这类直读无法与 `LspServerInfo`（camelCase）共用访问器 | `status` 用字面量 union 序列化（`#[serde(rename_all="kebab-case")]` + TS 同表）；`LspSessionInfo` 统一 camelCase，前端去掉 `as` | 真缺陷 |
| 13 | `src-tauri/src/lsp/diag_bus.rs:34-53` | `DiagnosticSubscription::drop` 用**存放时的 index** 从 `Vec` 里删；任何一次删除都会让后续索引整体前移 | 两个以上订阅者时：先 drop A(0) 后 drop B(1) → 列表已缩到 1，`1 < 1` 为假 ⇒ B 的 listener 永不摘除（泄漏且继续被 `publish` 调用）。当前生产只有 `set_app_handle`（`manager.rs:513-522`）一个订阅且 `mem::forget`，故未触发 | 用 `Arc<Listener>` + `retain(!Arc::ptr_eq)` 或 slot id（不随删除漂移） | 可接受 |
| 14 | `src-tauri/src/lsp/types.rs:341-360`（`LspDiagnostic`）、`src/features/lsp/types.ts:55-72` | 线上诊断是**原样透传**的 `serde_json::Value`（`transport.rs:98-113`），Rust `LspDiagnostic` 只在 `types.rs` 单测用；它缺 `codeDescription`/`tags`/`relatedInformation`/`data`，而 TS 侧声明了 `codeDescription` | 目前无影响（透传保证 TS 侧字段都在）。但若有人把该 DTO 接回线上路径（"类型化"重构），`codeDescription`/`data` 会被静默丢弃 ⇒ `diagnosticCode.ts` 的链接与 jdtls quickfix 匹配同时失效 | 删除未使用的 DTO，或补全字段后再接线 | 可接受 |
| 15 | `src-tauri/src/lsp/session/instance.rs:342-366` | reader 只消费 3 类服务器通知（publishDiagnostics / progress / serverStatus）；`window/showMessage`、`telemetry/event` 静默丢弃（连 debug 日志都没有） | 服务器用 `window/showMessage` 报「模块未配置 / classpath 过期」时用户零反馈（stderr 未必同步）；`showMessageRequest`（request）在 `server_request.rs:77` 有应答，notification 形态没有 | 至少在 reader 里 `log::info!` 落一行，或转发成 `lsp-session-*` 的 message | 可接受 |
| 16 | `src/features/lsp/store/lspStore.ts:80-95,283-289`；`.trellis/spec/backend/lsp-domain.md` §2 | 前端 `diagnosticsByProject` 权威副本 + `lspDiagnosticsProjection` 投影 + `progressTokens` 引用计数，都是后端/事件的派生副本 | 属 spec 已记录的「权威副本 + 可重建投影」「token 非空即 busy」决策，且投影可重建（配置重建后自愈）。唯一漂移点在 #3（清除粒度过粗） | — | 已记录取舍 |
| 17 | `src-tauri/src/lsp/session/status.rs:14-20`、`lifecycle.rs:149-152` | `LspSessionStatus::Indexing` 保留变体但 `phase_of` 归一为 `READY`、`as_str` 覆盖前端词表 | spec 明确「indexing 是展示态，相位归一 Ready」是有意决策；本身不是缺陷（真正的漂移见 #8：字面量绕过枚举） | — | 已记录取舍 |

## 已验证无问题的点（供回归参考）

- **事件名常量双端成立**：`types.rs:7-40` 与 `shared/events.ts:36-51` 六个常量逐字一致，业务代码无硬编码事件串（`grep "lsp-diagnostics-\|lsp-session-\|lsp-progress-\|lsp-apply-edit-"` 仅命中常量定义与注释）。
- **监听注销对称（除 #11）**：`lspStore.subscribeToProject`（`lspStore.ts:331-455`）先 `await` 再逐条 `safeUnlisten`，卸载兜底 `flushPendingDiag()`；`InstallProgressBridge` 用 `cancelled` 哨兵 + `safeUnlisten`；`LspSubscriptionBridge` 的 `cancelled`/`subscribedRef` 在 StrictMode 双挂载下每次 cleanup 都会调 `unlistenFn`。
- **大载荷已有预算的三处**：`lsp_get_server_logs`（1.5MB 条数+字节双预算 + 编译期断言 `manager.rs:83`）、`lsp_read_preauthorized_file`（512KB）、`lsp_go_to_definition` 预读（512KB）；`installer.rs:49-54` 对安装进度日志做 64KB 尾部 + 200ms 节流。
- **能力声明消费点**（红线 14 正面）：`definition.linkSupport` ← `symbol.rs:29-49` 解析 `LocationLink`；`completionItem.resolveSupport` ← `lspCompletionResolve.ts`；`codeActionLiteralSupport` ← `codeAction.ts`；`window.workDoneProgress` ← `notify.rs` + `server_request.rs:37`；`workspace.configuration` ← `server_request.rs:41`；`extendedClientCapabilities.classFileContentsSupport` ← `lsp_read_class_file_contents` ← `jdtUtils.ts:21`。
- **`src/shared/store/` 无 LSP 切片**（诊断/会话状态只住 `features/lsp/store`），不存在跨 store 的第二份镜像。
- **前后端 claim/registry 分工**：`documentOwnership.ts` 的 refCount 只是「0→1 才发 claim」的本地去抖，权威在后端 `editor_owned`；本身不是影子副本（但重启会丢，见 #2）。

## 复现/核对命令

```bash
# 1. 超时链路断开
rg -n "requestTimeoutMs" src/features/lsp/store/lspStore.ts src/features/settings/components/LspPanel.tsx  # 0 命中
rg -n "requestTimeoutMs" src/features/lsp/hooks/__tests__/lspClientManager.test.ts                        # 直接传参，绕过 mapper

# 2. 重启丢登记表
rg -n "clear_open_documents|editor_owned.remove|reopen_documents" src-tauri/src/lsp/session_store.rs src-tauri/src/lsp/manager.rs

# 3. 死 didOpen 出口
rg -n "lspOpenDocument|lspChangeDocument|lspCloseDocument" src/ --glob '!*__tests__*'   # 仅 api 定义，零调用

# 4. 假声明
rg -n "relatedInformation" src/ --glob '!*__tests__*'   # 0 命中
```
