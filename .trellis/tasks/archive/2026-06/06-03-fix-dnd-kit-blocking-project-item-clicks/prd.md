# Fix dnd-kit blocking project item clicks

## Goal

dnd-kit 拖拽引入后，默认 PointerSensor 在 pointerdown 瞬间激活拖拽，导致 ProjectItem 内所有点击/按钮操作被吞掉。需要添加 activationConstraint 让拖拽仅在指针移动一定距离后启动。

## Requirements

* DndContext 配置 PointerSensor 的 activationConstraint（distance: 5）
* 同时配置 KeyboardSensor 保留键盘拖拽能力
* ProjectsPanel 和 ConnectionProjectCard 两处 DndContext 都需要修复
* 修复后点击 toggle、按钮、右键菜单恢复正常
* 拖拽排序功能不受影响

## Acceptance Criteria

* [ ] 点击 project item 可正常 toggle 展开/折叠
* [ ] HeaderActionButton 点击正常触发
* [ ] 右键菜单正常弹出
* [ ] 拖拽移动 5px 后启动排序，手感自然
* [ ] type-check 通过

## Definition of Done

* Lint / typecheck green
* 手动验证点击和拖拽行为

## Technical Approach

在 DndContext 使用 `useSensors` + `useSensor(PointerSensor, { activationConstraint: { distance: 5 } })` 配置传感器。这是 dnd-kit 官方推荐的解决方案。

## Out of Scope

* 拖拽手柄 UI 改造
* 触摸设备优化
