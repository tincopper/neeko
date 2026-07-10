# LSP 稳定性修复 — 技术设计

## 架构变更概览

```
当前 (惰性创建, 无状态事件):
  Frontend          Rust Backend           LSP Server
    │                  │                      │
    │── lsp_transport ─► get_or_create ──────►│  (spawn + init, 无前端感知)
    │◄─ response ──────│◄─────────────────────│
    │                  │ (progress → 仅 log)  │

目标 (事件推送, 生命周管理):
  Frontend          Rust Backend           LSP Server
    │                  │                      │
    │◄─ lsp-session ───│ (starting → initializing → ready/error)
    │── lsp_transport ─►──────────────────►│
    │◄─ response ──────│◄─────────────────────│
    │◄─ lsp-progress ──│ (indexing 45%) ◄────│
    │── lsp_restart ──►│ shutdown → kill → recreate
    │── lsp_stop ─────►│ shutdown → kill → cleanup
```

---

## 模块变更清单

### 1. Rust 后端 — manager.rs

#### 1.1 Session 状态模型

```rust
// 替代 LspSessionInfo.connected: bool
enum LspSessionStatus {
    Starting,       // 子进程已 spawn，正在 initialize handshake
    Initializing,   // initialize 完成，正在发送 initialized
    Indexing,       // 服务器索引中 ($/progress begin/report)
    Ready,          // 索引完成，正常服务中
    Error(String),  // 启动失败或运行时错误
    Stopped,        // 用户手动停止
}

struct LspSession {
    // ... 现有字段不变 ...
    status: LspSessionStatus,
    child_process: Option<std::process::Child>,  // 新增: 持有子进程句柄用于 kill
}
```

#### 1.2 状态事件发射

`LspSession::new()` 中增加状态流转，每次变更调用 `emit_session_event()`：

```
spawn 子进程          → Starting
initialize response   → Initializing  
$/progress begin      → Indexing { message, pct }
$/progress end        → Ready
任何错误              → Error(msg)
close_session 调用    → Stopped
```

```rust
fn emit_session_event(
    &self,
    transport: &IpcTransport,
    project_path: &str,
    language_id: &str,
    status: LspSessionStatus,
    message: Option<&str>,
    progress_pct: Option<u32>,
)
```

事件名格式: `lsp-session-{project_path}`, payload 与前端 `LspSessionStatusEvent` 对齐。

#### 1.3 Progress 转发

`handle_progress_notification` 当前只 log。改为通过 `diag_bus` 类似的机制推送到 `IpcTransport::push_progress()`，并在 `begin`/`end` 时调用 `emit_session_event` 切换 Indexing/Ready 状态。

需要将 `IpcTransport` 实例注入到 `LspSession`（当前 `handle_progress_notification` 是自由函数，没有 transport 引用）。方案：在 `LspSession` 中持有 `Arc<IpcTransport>`。

#### 1.4 child_process 持有

`LspSession::new()` 中 `Command::new().spawn()` 返回的 `Child` 结构体，当前 drop 在 scope 结束时。改为持有到 session 生命周期：

```rust
struct LspSession {
    child: Option<std::process::Child>,  // 新增字段
}
```

`close_session()` 时调用 `child.kill()` + `child.wait()`。

#### 1.5 lsp_go_to_definition 修复

`commands.rs:332-353` 的 auto-didOpen 块末尾增加：

```rust
state.lsp_manager.register_open_document(
    &project_path, &language_id, &uri, &text, 1,
);
```

### 2. Rust 后端 — commands.rs

#### 2.1 新增命令

```rust
#[tauri::command]
pub async fn lsp_restart_session(
    project_path: String,
    language_id: String,
    state: State<'_, AppStateWrapper>,
) -> Result<LspSessionInfo, AppError>

#[tauri::command]
pub fn lsp_stop_session(
    project_path: String,
    language_id: String,
    state: State<AppStateWrapper>,
) -> Result<(), AppError>
```

`lsp_restart_session` 流程：
1. 发送 `shutdown` 请求（如果 session 存活）
2. `child.kill()`
3. 从 sessions HashMap 移除旧 session
4. `get_or_create_session()` 重新创建
5. `reopen_documents()` 恢复
6. 返回新 session info

`lsp_stop_session` 流程：
1. 发送 `shutdown` 请求
2. `child.kill()`
3. 清理 session 和 open_docs 条目
4. 发射 Stopped 事件

#### 2.2 shutdown 处理修复

`commands.rs:254-261` 当前直接返回 null。改为：

```rust
if method == "shutdown" {
    // 转发 shutdown 到 server
    state.lsp_manager.send_notification(...)；
    // 不等待 response，直接返回
    return Ok(...)
}
```

#### 2.3 命令注册

在 `neeko_invoke_handler!` 中添加 `lsp_restart_session` 和 `lsp_stop_session`。

### 3. Rust 后端 — app_state.rs

`shutdown_background_and_exit` 中增加：

```rust
lsp_manager.close_all_sessions();  // 内部调用 child.kill()
```

### 4. Rust 后端 — types.rs

```rust
#[derive(Debug, Clone, Serialize)]
pub struct LspSessionInfo {
    pub language_id: String,
    pub project_path: String,
    pub server_name: String,
    pub status: String,  // 替代 connected: bool
    pub status_message: Option<String>,
    pub progress_pct: Option<u32>,
}
```

### 5. 前端 — 新增 LSP 状态 Store + StatusBar 改造

#### 5.1 状态 Store

```typescript
// src/features/lsp/store/lspStore.ts
interface LspSessionState {
  languageId: string;
  serverName: string;
  status: 'starting' | 'initializing' | 'indexing' | 'ready' | 'error' | 'stopped';
  statusMessage?: string;
  progressPct?: number;
}

interface LspState {
  sessions: Record<string, LspSessionState[]>;  // projectPath → sessions
}

// 通过监听 lsp-session-{projectPath} 事件更新
```

#### 5.2 StatusBar 改造

- 移除当前 5 秒轮询 `lspListSessions()`
- 改为订阅 `lsp-session-{projectPath}` 事件实时更新
- 展示当前活跃文件对应的 LSP server 状态
- Hover/click 弹出 dropdown，列出所有已加载 server + 状态 + restart/stop 按钮
- Dropdown 样式：每行 language_id | status icon | 操作按钮

#### 5.3 调用新命令

重启/停止操作通过 `lspApi.ts` 新增函数调用：
```typescript
export async function lspRestartSession(projectPath: string, languageId: string): Promise<LspSessionInfo>
export async function lspStopSession(projectPath: string, languageId: string): Promise<void>
```

### 6. 前端 — 死代码清理

移除文件：
- `src/features/lsp/hooks/useLsp.ts` (未被 FileViewer 使用)
- `src/features/lsp/hooks/useLspHover.ts`（未被使用）
- `src/features/lsp/hooks/useLspCompletion.ts`（未被使用）
- `src/features/lsp/hooks/useLspDiagnostics.ts`（诊断通过 @codemirror/lsp-client 处理）
- `src/features/lsp/components/LspStatusBar.tsx`（将被新的 StatusBar 逻辑替代）

保留但整合：
- `FileViewer.tsx:92-113` 的 `LSP_LANGUAGE_MAP` 统一到 `src/features/lsp/languageMap.ts` 单一源
- `useLsp.ts:12-34` 的映射移除

### 7. 前端 — Hover 就绪保护 (lspClientManager)

收到 `lsp-session-{projectPath}` 的 `ready` 事件后：
- 若当前 transport 已连接且 server ready，re-trigger `@codemirror/lsp-client` 的 capability 同步
- 确保 hover/definition/completion 在 server 索引完成后能被正确响应

```typescript
// lspClientManager.ts 增加
function onSessionReady(projectPath: string, languageId: string) {
  const key = clientKey(projectPath, languageId);
  const entry = clients.get(key);
  if (entry) {
    // trigger re-capability check to unblock hover
    entry.client.notifyReady(); // or equivalent refresh
  }
}
```

### 8. 前端 — LspSessionInfo 类型更新

```typescript
// src/features/lsp/types.ts
export interface LspSessionInfo {
  language_id: string;
  project_path: string;
  server_name: string;
  status: string;           // 替代 connected: boolean
  status_message?: string;
  progress_pct?: number;
}
```

---

## 数据流契约

| 事件 | 触发条件 | Payload |
|------|----------|---------|
| `lsp-session-{projectPath}` | session 状态变更 | `{ languageId, status, message?, progressPct? }` |
| `lsp-progress-{projectPath}` | server $/progress 推送 | `{ languageId, token, kind, message, percentage }` |
| `lsp-diagnostics-{projectPath}` | server publishDiagnostics | (不变) |

| 命令 | 方向 | 用途 |
|------|------|------|
| `lsp_transport` | 双向 | JSON-RPC 代理 (不变) |
| `lsp_go_to_definition` | 前端→后端 | 优化跳转 (修复文档追踪) |
| `lsp_restart_session` | 前端→后端 | **新增** 重启 session |
| `lsp_stop_session` | 前端→后端 | **新增** 停止 session |
| `lsp_list_sessions` | 前端→后端 | 查询 session 列表 (保留, 用于初始化) |

---

## 兼容性

- 所有变更向后兼容：现有前端 API 签名不变
- `LspSessionInfo.connected` → `status` 是 schema 变化，前端需同步更新
- `lsp_transport` 协议不变，不影响 `@codemirror/lsp-client` 集成

## Rollback

如遇问题：`git revert` 本 commit 即可恢复。无数据库迁移，无持久化状态变更。

---

## Design Principles

### TDD (红→绿→重构)

每个 Step 遵循垂直切片：

```
RED:   为新行为编写一个失败测试
GREEN: 编写最小量代码使测试通过
REFACTOR: 消除重复，深化模块
```

禁止水平切片（先写完所有测试再写代码）。每次只写一个测试，确保测试描述的是**行为**而非实现细节。

### 高内聚、低耦合

| 原则 | 实践 |
|------|------|
| 单一职责 | `LspSession` 只管理单 session 生命周期，事件发射委托给 `IpcTransport` |
| 依赖注入 | `IpcTransport` 通过 Arc 注入 LspSession，便于测试时 mock |
| 共享抽象 | `LspTransport` trait 已存在，`IpcTransport` 是实现类，不可新增重复抽象 |
| 前端 store | `lspStore.ts` 是 session 状态单一事实源，StatusBar / FileViewer 从 store 读取，不各自维护状态 |

### 代码复用

- `emit_session_event` 方法复用 `IpcTransport` 的现有 `emit` 模式（与 `push_diagnostics` 一致）
- `handle_progress_notification` 改造后复用 `emit_session_event` 发 Indexing/Ready 状态
- `lsp_restart_session` 复用 `close_session` + `get_or_create_session` + `reopen_documents`
- 前端语言映射单一源：`languageMap.ts` 被 `FileViewer.tsx`、`lspClientManager.ts`、`StatusBar.tsx` 共用
