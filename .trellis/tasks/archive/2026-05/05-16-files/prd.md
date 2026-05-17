# Files 面板添加目录展开箭头指示器

## Goal

在 Files 面板的每个目录节点前添加 ▶/▼ 箭头，直观展示目录当前是否可展开（展开态 vs 收起态）。纯前端改动，零后端变更。

## Requirements

* 所有 `is_dir` 节点前显示 chevron 图标（永不隐藏，包括空目录）
* 收起态 → `ChevronRight` (▶)
* 展开态 → `ChevronDown` (▼)，带 CSS transition 旋转动画
* 点击 chevron 或整行均触发 toggle 展开/收起（行为不变）
* 文件节点不显示箭头

## Acceptance Criteria

* [ ] 目录行出现 chevron 图标，位于 folder icon 左边
* [ ] 展开目录时 chevron 从 ▶ 旋转为 ▼（带 transition）
* [ ] 收起目录时 chevron 从 ▼ 旋转回 ▶（带 transition）
* [ ] 真空目录展开后 chevron 保持 ▼，不隐藏
* [ ] 文件行无 chevron
* [ ] 现有功能不受影响：懒加载、刷新、active file 高亮、自动展开父目录

## Definition of Done

* `pnpm lint` / `pnpm type-check` / `pnpm test:run` 通过
* 手动验证 Files 面板箭头显示正确

## Technical Approach

**只改一个文件**：`src/components/panels/FilesPanel.tsx`

1. 在 `FileTreeNode` 组件中，对 `node.is_dir` 的分支，在 `<img>` 前插入 chevron
2. 使用 `lucide-react` 的 `ChevronRight` / `ChevronDown`
3. chevron 带 `transition-transform duration-150`（与 shadcn 菜单风格一致）

```
现在:  [folder icon] src/
改为:  [▶/▼] [folder icon] src/
```

### 代码位置

`FileTreeNode` 函数的 `node.is_dir` 分支（第 86-99 行），在 `<img>` 之前插入：

```tsx
{isExpanded ? (
  <ChevronDown className="w-3.5 h-3.5 shrink-0 text-text-muted transition-transform duration-150" />
) : (
  <ChevronRight className="w-3.5 h-3.5 shrink-0 text-text-muted transition-transform duration-150" />
)}
```

## Decision (ADR-lite)

**Context**: 需要指示目录展开状态，当前只有 folder icon (open/closed) 区分不够直观。
**Decision**: 永远显示 chevron（方案 A），使用 lucide-react `ChevronRight`/`ChevronDown`，带 CSS transition。
**Consequences**: 零后端改动，纯前端；空目录也显示箭头（与 VS Code / Finder 一致）。

## Out of Scope

* 不新增 `has_children` 字段
* 不改 Rust 后端
* 不隐藏空目录的箭头

## Technical Notes

* `lucide-react` ^1.7.0 已安装，`ChevronRight` 已在 `dropdown-menu.tsx` / `context-menu.tsx` 使用
* 改动文件：`src/components/panels/FilesPanel.tsx`
* `FileTreeNode` 已用 `React.memo` 包裹，性能无影响
