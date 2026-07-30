# LSP Frontend Cleanup

## Goal

修复 LSP review 中标记为 Major/Minor 的前端问题：transport listener 泄漏、DiagnosticBus compaction、capabilities 探测、自定义 server 解析、dead code。

## Requirements

### #7 修复 TauriLspTransport listener 泄漏

**文件**: `src/features/lsp/transport/tauriLspTransport.ts`

- `subscribe` 方法在注册新 listener 前先清理旧 listener（调用保存的 unlisten handle）
- 或改为幂等调用：相同参数重复调用不产生新 listener
- `destroy()` 清理所有注册的 listener

### #10 DiagnosticBus 添加 compaction

**文件**: `src-tauri/src/lsp/diag_bus.rs`

- `unsubscribe` 时从 Vec 中移除 slot（而非替换为 no-op）
- 或使用 `retain` 清理 dropped subscription
- `subscriber_count` 返回活跃订阅数

### #11 重构 useLspCapabilities

**文件**: `src/features/lsp/hooks/useLspCapabilities.ts`

- 移除假 hover 探测（`file://${projectPath}/_probe_`）
- 从 LSP `initialize` 响应读取真实 capability 标志
- 失败时静默降级（不弹 warning notification）

### #12 修复 language_for_path 自定义 server 支持

**文件**: `src-tauri/src/lsp/manager.rs`

- `language_for_path` 静态方法改为使用已注册的 plugin registry（含自定义 server）
- 或废弃静态方法，统一使用 `resolve_language_for_path`

### #22 删除 dead code LspHoverTooltip

**文件**: `src/features/lsp/components/LspHoverTooltip.tsx`

- 确认无引用后删除文件
- 功能已由 `createLspHoverTooltips` 通过 CodeMirror hoverTooltip 实现

## Acceptance Criteria

- [ ] 重复调用 `subscribe` 不泄漏 listener
- [ ] DiagnosticBus 在 unsubscribe 后正确 compact
- [ ] capabilities 不再发送假 hover 请求
- [ ] 自定义 LSP server 在路径解析时可见
- [ ] `LspHoverTooltip.tsx` 已删除
- [ ] `pnpm lint:fe` 通过
- [ ] `cargo test` 通过

## Constraints

- capabilities 重构需兼容现有 `useLspCapabilities` 调用方
- DiagnosticBus compaction 需线程安全

## References

- Review finding: `history://LspCodeReview`
- Key files:
  - `src/features/lsp/transport/tauriLspTransport.ts`
  - `src-tauri/src/lsp/diag_bus.rs`
  - `src/features/lsp/hooks/useLspCapabilities.ts`
  - `src-tauri/src/lsp/manager.rs`
  - `src/features/lsp/components/LspHoverTooltip.tsx`
