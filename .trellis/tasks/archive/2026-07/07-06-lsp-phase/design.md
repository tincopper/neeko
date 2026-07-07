# Phase 1: LSP 代码跳转 — 技术设计

## 整体架构

```
Frontend (TS/React)                Backend (Rust/Tauri)              LSP Server
       │                                │                              │
       │── invoke("lsp_request") ───────►│── JSON-RPC req ──stdin─────►│
       │◄── invoke 返回 ─────────────────│◄── JSON-RPC res ──stdout────│
       │                                │                              │
       │◄── event("lsp-diagnostics") ────│◄── JSON-RPC notif ──stdout──│
       │── invoke("lsp_notification") ►│── JSON-RPC notif ──stdin────►│
```

### 通信模式（与终端架构对称）

| 模式 | LSP 类比 | 终端类比 |
|------|----------|----------|
| invoke 命令 | `lsp_request` (req/res) | `create_terminal_session` |
| Tauri event (push) | `lsp-diagnostics` | `terminal-output-{id}` |
| invoke 单向通知 | `lsp_notification` | - |

## 后端设计

### 新增模块: `src-tauri/src/lsp/`

```
src-tauri/src/lsp/
├── mod.rs        — LspManager 定义 + pub 导出
├── manager.rs    — LspManager 实现 (spawn/kill/请求/通知)
├── commands.rs   — Tauri 命令入口
└── types.rs      — 可序列化类型
```

### LspManager

```rust
pub struct LspManager {
    sessions: Arc<Mutex<HashMap<String, LspSession>>>,
}

struct LspSession {
    language_id: String,
    project_path: String,
    connection: lsp_server::Connection,
    io_threads: lsp_server::IoThreads,
    server_capabilities: Option<serde_json::Value>,
    restart_count: u32,
}
```

### 后端命令

| 命令 | 参数 | 返回 | 说明 |
|------|------|------|------|
| lsp_request | project_path, language_id, method, params | Value | 同步请求 |
| lsp_notification | project_path, language_id, method, params | () | 单向通知 |
| lsp_open_document | project_path, language_id, uri, text, version | () | 打开文档 |
| lsp_change_document | project_path, language_id, uri, version, changes | () | 变更文档 |
| lsp_close_document | project_path, language_id, uri | () | 关闭文档 |
| lsp_close_session | project_path, language_id | () | 关闭会话 |

### 语言发现

```rust
fn language_for_extension(ext: &str) -> Option<&'static str> {
    match ext {
        "rs" => Some("rust"),
        "py" => Some("python"),
        "ts" | "tsx" => Some("typescript"),
        "js" | "jsx" => Some("javascript"),
        _ => None,
    }
}

fn lsp_server_command(language: &str) -> Option<Vec<&'static str>> {
    match language {
        "rust" => Some(vec!["rust-analyzer"]),
        "python" => Some(vec!["pyright-langserver", "--stdio"]),
        "typescript" => Some(vec!["typescript-language-server", "--stdio"]),
        _ => None,
    }
}
```

## 前端设计

### 新增: `src/features/lsp/`

```
src/features/lsp/
├── api/lspApi.ts
├── hooks/useLsp.ts
├── hooks/useLspDiagnostics.ts
├── hooks/useLspHover.ts
├── components/LspStatusBar.tsx
├── components/DiagnosticsPanel.tsx
└── types.ts
```

### CodeMirror 集成点

- `FileViewer.tsx`: 文件打开/变更/关闭时调用 LSP API
- diagnostics -> gutter 标记 + 波浪线 decorations
- autocomplete 接入 LSP completion 源
- hover 工具提示

## AppStateWrapper 变更

```rust
pub lsp_manager: lsp::LspManager,  // 新增
```

## AppError 变更

```rust
#[error("LSP error: {0}")]
Lsp(String),  // 新增
```
