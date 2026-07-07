# Phase 1: LSP 代码跳转 — 执行计划

## 依赖添加

```bash
cd src-tauri && cargo add lsp-server lsp-types
```

## 执行清单

### Step 1: 后端基础模块
- [ ] 创建 `src-tauri/src/lsp/mod.rs` — LspManager + 关联类型
- [ ] 创建 `src-tauri/src/lsp/types.rs` — 可序列化类型
- [ ] 创建 `src-tauri/src/lsp/manager.rs` — LspManager 实现
  - get_or_create_session / spawn_server / request / notification / close_session
  - language_for_extension / lsp_server_command
  - diagnostics push event emit

### Step 2: 后端命令注册
- [ ] 创建 `src-tauri/src/lsp/commands.rs`
- [ ] 添加到 `neeko_invoke_handler!` (lib.rs)
- [ ] 添加到 `AppStateWrapper` (app_state.rs)
- [ ] 在 app.rs 初始化 LspManager
- [ ] AppError 添加 Lsp 变体

### Step 3: 后端测试
- [ ] LspManager 单元测试
- [ ] 语言发现映射测试
- [ ] cargo test 通过

### Step 4: 前端 API + Hooks
- [ ] `src/features/lsp/types.ts`
- [ ] `src/features/lsp/api/lspApi.ts`
- [ ] `src/features/lsp/hooks/useLsp.ts`
- [ ] `src/features/lsp/hooks/useLspDiagnostics.ts`

### Step 5: CodeMirror 集成
- [ ] FileViewer.tsx 集成 (open/change/close)
- [ ] diagnostics decorations (波浪线 + gutter)
- [ ] autocomplete 接入 LSP
- [ ] hover 工具提示

### Step 6: UI 组件
- [ ] LspStatusBar.tsx
- [ ] DiagnosticsPanel.tsx
- [ ] 右键菜单 + 快捷键

### Step 7: 质量验证
```bash
cargo check --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml
pnpm lint && pnpm type-check && pnpm test:run
```
