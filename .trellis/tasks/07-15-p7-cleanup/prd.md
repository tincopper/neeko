# P7: 清理收尾 — 测试 + 文档

## Goal

完成所有清理工作：删除废弃类型和导出、更新测试、运行完整质量检查、更新 spec 文档。确保重构后的代码库干净、可维护、无技术债务残留。

## Requirements

1. **类型清理**：
   - 确认 `gitApi.ts`、`fileApi.ts`、`commandFactory.ts` 中所有 transport 相关类型已删除
   - 确认 `WSLProject`/`RemoteProject`/`connectionContext` 类型已删除
   - 确认重导出链（`shared/types/`）无死引用
2. **测试更新**：
   - `commandFactory.test.ts`：完全重写（不再验证 transport 参数）
   - `useWslActions.test.ts` / `useRemoteActions.test.ts`：适配新 store 结构
   - `useCrossTypeSelection.test.ts`：适配或删除
   - `OpenIdeButton.test.tsx`、`useKeyboardShortcuts.test.ts`：更新 selector
   - `useWorktreeActions.test.ts`：更新引用
   - `ConnectionProjectCard.test.tsx`：更新类型
3. **权限检查**：`src-tauri/capabilities/` 中无 transport 相关引用
4. **质量门禁**：
   - `pnpm lint` 通过
   - `pnpm type-check` 通过
   - `pnpm test:run` 通过
   - `cargo check` 通过
   - `cargo test` 通过
5. **Spec 文档更新**：在 `.trellis/spec/` 中记录 core 模块的职责和依赖关系

## Acceptance Criteria

- [ ] 代码库无 `GitTransportKind` / `FileTransportKind` / `WSLProject` / `RemoteProject` / `connectionContext` 引用
- [ ] 所有测试通过
- [ ] `pnpm lint` 无 error
- [ ] `pnpm type-check` 无 error
- [ ] `cargo check` 无 error / warning（预期 warn 除外）
- [ ] `cargo test` 通过
- [ ] spec 文档已更新

## Dependencies

- P1~P6 全部完成
