# 修复面板圆角缺失

## Goal

修复所有面板容器中 `rounded-*` 缺少 `overflow-hidden` 的问题，防止子内容直角溢出覆盖父级圆角。

## What I already know

* 根因：`EditorGroupLayout.tsx:178` 的 `ResizablePanelGroup` 有 `rounded-lg` 但缺少 `overflow-hidden`
* `ResizablePanel` 组件本身内置了 `overflow-hidden`（`resizable.tsx:23`），所以子面板已有裁剪保护
* 但 `ResizablePanelGroup` 没有内置 `overflow-hidden`，需要手动添加
* 全面审计发现 7 处类似问题

## Requirements

* 修复所有 `rounded-*` 缺少 `overflow-hidden` 的面板容器

## Acceptance Criteria

* [ ] 所有面板容器同时具有 `rounded-*` 和 `overflow-hidden`
* [ ] 无视觉回归（圆角正确显示，无内容溢出）

## Definition of Done

* Lint/type-check 通过
* 视觉验证圆角效果

## Technical Approach

在以下文件的 className 中添加 `overflow-hidden`：

1. `src/features/editor/components/EditorGroupLayout.tsx:178` — ResizablePanelGroup
2. `src/ui/dialog.tsx:52` — Dialog 内容容器
3. `src/shared/components/AppToast.tsx:13` — Toast 容器
4. `src/features/editor/components/FileViewer.tsx:447` — Modal 容器

## Decision (ADR-lite)

**Context**: 面板圆角是 "islands" 设计模式的一部分，需要 `overflow-hidden` 确保子内容不溢出圆角边界
**Decision**: 全面修复所有发现的问题，而不只是 EditorGroupLayout
**Consequences**: 统一所有面板的圆角处理方式，减少后续维护成本

## Out of Scope

* 小 UI 元素（按钮、图标、badge）的圆角处理（低风险，不需要 overflow-hidden）
* 下拉菜单（WSLDialog、RemoteDialog）的 overflow-y-auto 处理（单独考虑）
* ContextMenu（CommitList.tsx）的圆角处理（低风险）

## Technical Notes

* `ResizablePanel` 内置 `overflow-hidden`：`src/ui/resizable.tsx:23`
* `ResizablePanelGroup` 无内置 `overflow-hidden`：`src/ui/resizable.tsx:129`
* 审计报告：`.trellis/tasks/editorgrouplayout/research/rounded-overflow-audit.md`
