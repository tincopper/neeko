# P7 Design: 清理收尾

## 测试文件清单与变更策略

| 测试文件 | 行数 | 变更类型 |
|---------|------|---------|
| `src/features/project/hooks/use-active-project/__tests__/commandFactory.test.ts` | ~473 | **完全重写** — 不再验证 invoke 的 transport 参数，改为验证 projectId |
| `src/features/connection/hooks/__tests__/useWslActions.test.ts` | ~80 | 更新 mock store |
| `src/features/connection/hooks/__tests__/useRemoteActions.test.ts` | ~120 | 更新 mock store |
| `src/features/connection/hooks/__tests__/useRemoteProjects.test.ts` | ~180 | 更新 mock store |
| `src/features/connection/hooks/__tests__/useWslProjects.test.ts` | ~100 | 更新 mock store |
| `src/features/connection/components/__tests__/ConnectionProjectCard.test.tsx` | ~80 | 更新类型 |
| `src/features/project/hooks/__tests__/useWorktreeActions.test.ts` | ~60 | 更新 store 引用 |
| `src/shared/hooks/__tests__/useKeyboardShortcuts.test.ts` | ~200 | 更新 store 契约 |
| `src/layout/__tests__/OpenIdeButton.test.tsx` | ~80 | 更新 selector |

## 废弃文件删除清单

- `src/features/project/hooks/useCrossTypeSelection.ts` — 功能合并到 `useProjectSelection.ts`
- `src/shared/types/connection.ts` — 或大幅缩减
- `src/features/connection/index.ts` 中停止导出项目相关类型

## 质量门禁执行顺序

```bash
# 1. Rust 侧
cargo check --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml

# 2. 前端 lint + type-check
pnpm lint
pnpm type-check

# 3. 前端测试
pnpm test:run

# 4. 全量
pnpm test:coverage  # optional, 检查是否有新增未覆盖行
```

## Spec 文档更新

需要更新或新增：

- `.trellis/spec/backend/index.md`：添加 `core/` 模块的说明和依赖关系
- `.trellis/spec/guides/index.md`：如果存在 `core` 相关指南则更新
- 新增 `.trellis/spec/backend/core.md`：描述 core 模块职责（Project、ProjectEnvironment）和引用规则

## 回归检查清单

### Backend
- [ ] Local 项目：创建、删除、rename、change_path
- [ ] WSL 项目：加载、会话恢复
- [ ] SSH 项目：连接、加载
- [ ] Git 操作：stage、commit、push、pull、branch（三种环境）
- [ ] PR 操作：list、view、create、merge、close（仅 local）
- [ ] 文件浏览：read_dir_tree、read_file_content（三种环境）
- [ ] 会话保存/加载：数据完整

### Frontend
- [ ] 项目选择：点击面板/终端切换
- [ ] Git commit panel：工作正常
- [ ] 终端：local/WSL/SSH 均能打开
- [ ] 编辑器：文件视图正常
- [ ] 快捷键：导航正常
- [ ] PR 面板：加载正常（修复后的核心验证点）
