# New Action Menu — 执行计划

## 前置依赖

- 当前任务处于 `planning` 状态，本方案与原型已产出，待用户评审后执行。
- 实现前需确认：
  1. 命令面板快捷键是否用 `Ctrl+Shift+A`（备选 `Ctrl+Shift+P` / `Ctrl+K`）。
  2. 是否在本轮同时实现“命令面板”，还是先做下拉页 MVP，命令面板作为二期。
  3. Agent 子展开项是悬浮二级菜单还是内联展开。
  4. “New File” 是否接受后端新增 `create_new_file` 命令（推荐方案 A）。

## 实施阶段

### Phase 1 — 基础设施与配置表

目标：新建 `features/action-menu` 目录，定义类型与动作注册表，不改动业务代码。

- [ ] 创建 `src/features/action-menu/types/actionMenu.ts`
- [ ] 创建 `src/features/action-menu/actionRegistry.ts`
  - 声明 6-8 个动作
  - 提供 `getActionMenuItems(ctx)` 函数，自动过滤 visible/disabled
- [ ] 创建 `src/features/action-menu/hooks/useActionMenu.ts`
  - 搜索过滤、选中索引、键盘事件、执行
- [ ] 创建 `src/features/action-menu/utils/filterActions.ts`
  - 简单包含匹配，预留拼音/缩写扩展接口
- [ ] 创建 `src/features/action-menu/__tests__/filterActions.test.ts`
- [ ] 创建 `src/features/action-menu/__tests__/useActionMenu.test.ts`

验证：

```bash
pnpm test src/features/action-menu
```

### Phase 2 — 下拉页组件

目标：实现 `ActionMenuDropdown` 与 `ActionMenuItem`，并在 TabBar 中替换 “+” 按钮。

- [ ] 创建 `src/features/action-menu/components/ActionMenuItem.tsx`
- [ ] 创建 `src/features/action-menu/components/ActionMenuDropdown.tsx`
  - 支持分组标题、搜索框、Agent 子列表、最近文件
  - 使用 `bg-popover`、CSS 变量字体大小
- [ ] 修改 `src/features/editor/components/TabBar.tsx`
  - 用 `ActionMenuButton` + `ActionMenuDropdown` 替换原有 “+” 按钮
  - 注入 `onAddTerminal`、`onAddAgentTerminal`、`onOpenFile` 等回调
- [ ] 修改 `src/features/editor/components/EditorGroupPane.tsx` / `EditorGroupLayout.tsx`
  - 把新增动作回调从 `onAddTerminalTab` 扩展为 `onActionMenuAction`
- [ ] 修改 `src/app/components/ProjectWorkspace.tsx`
  - 连接 `useTerminalTabs.addTab`、`useQuickOpenStore.openPalette('gotoFile')`、`openProjectFile`、现有快捷键处理函数
  - 实现 `new-file` 回调：弹出路径输入 → 调用 `create_new_file` → 打开文件 tab

验证：

```bash
npx tsc --noEmit
pnpm test src/features/editor src/features/action-menu
```

### Phase 3 — 命令面板（可选，建议与下拉页同步做）

目标：实现全局 `ActionPalette`，并通过 `Ctrl+Shift+A` 打开。

- [ ] 创建 `src/features/action-menu/store/actionPaletteStore.ts`
- [ ] 创建 `src/features/action-menu/components/ActionPalette.tsx`
- [ ] 在 `src/app/components/ProjectWorkspace.tsx` 挂载 `ActionPalette`
- [ ] 在 `src/features/keyboard/useKeyboardShortcuts.ts` 注册 `Ctrl+Shift+A`
- [ ] 命令面板关闭时焦点返回触发源

验证：

```bash
pnpm test src/features/action-menu
```

### Phase 4 — 集成与回归

- [ ] 在 `ProjectWorkspace` 中补齐 ActionContext（projectId、worktreePath、agents、recentFiles 等）
- [ ] 后端：实现 `create_new_file` 命令并补充 Rust 单元测试
- [ ] 确保终端 10 个上限仍生效
- [ ] 确保 AgentSelector 原有入口不被破坏
- [ ] 确保 QuickOpen 打开后 ActionMenuDropdown 已关闭（互斥）
- [ ] 跑全量前端测试 + Rust 测试

验证：

```bash
pnpm test
npx tsc --noEmit
cargo check --manifest-path src-tauri/Cargo.toml
```

### Phase 5 — 代码审查与文档

- [ ] 添加/更新 `docs/neeko-development-spec.md` 或相关文档（如需要）
- [ ] 在 `SESSION_CONTEXT.md` 记录架构决策
- [ ] 提交 PR：测试 + 实现 + 设计文档

## 回滚点

| 阶段 | 回滚策略 |
|------|---------|
| Phase 1 | 删除 `features/action-menu` 目录即可 |
| Phase 2 | 回滚 `TabBar.tsx`、`EditorGroupPane.tsx`、`EditorGroupLayout.tsx`、`ProjectWorkspace.tsx` 到原 `onAddTerminalTab` 调用 |
| Phase 3 | 移除 `ActionPalette` 挂载与快捷键注册 |

## 时间估算

- Phase 1：2-3h
- Phase 2：4-6h
- Phase 3：3-4h
- Phase 4：3-4h（含后端 `create_new_file`）
- Phase 5：1-2h

总计：13-19h（单人）。
