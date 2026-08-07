# Implement — 拖拽未 pin tab 到 pinned tab 触发 pin

## 执行清单（TDD）

1. **红灯测试**：为 `TabBar` / `EditorGroupPane` 拖拽逻辑补充测试，覆盖「拖到 pinned 面板区域触发 pin」「left/right 组内 reorder 不回归」。
   - 若拖拽逻辑难以组件级测试，将容器判定/pin 分发提取为纯函数，直接单测。
2. **共享 DndContext 提升**：在 `EditorGroupLayout.tsx` 创建共享 `DndContext`，包裹三个 `EditorGroupPane`；实现 `handleDragEnd` 按容器分发。
3. **容器标识**：为 pinned 面板定义 droppable 容器 id（如 `pinned-panel:{tabKey}`）；left/right 沿用 tab 级 sortable id。
4. **TabBar 改造**：`TabBar.tsx` 移除自建 `DndContext`，保留 `SortableContext`，新增 `onDropOnPinned` 回调。
5. **EditorGroupPane 透传**：`EditorGroupPane.tsx` 将拖拽事件与容器判定信息上抛给 `EditorGroupLayout`；pinned 面板保持 `reorderable={false}`。
6. **绿灯验证**：跑测试确认通过。
7. **重构**：收敛重复，确认容器前缀判定逻辑清晰。

## 验证命令

```bash
pnpm test:run
pnpm type-check
pnpm lint
cargo test --manifest-path src-tauri/Cargo.toml  # 无后端改动，可选
```

## 风险文件 / 回滚点

- `src/features/editor/components/EditorGroupLayout.tsx` — 主改动点（共享 DndContext）。
- `src/features/editor/components/TabBar.tsx` — DndContext 移除，最易回归。
- `src/features/editor/components/EditorGroupPane.tsx` — 事件上抛。
- 回滚：还原三个文件到 git HEAD。

## 提交前检查

- [ ] left/right 组内排序手动验证不回归。
- [ ] 拖到 pinned 面板区域触发 pin。
- [ ] pinned tab 不可被拖出。
- [ ] `pnpm test:run`、`pnpm type-check`、`pnpm lint` 通过。