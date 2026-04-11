# 分支展示改为 Dropdown 下拉列表

## Goal

将当前展开式的平铺分支列表替换为可搜索的下拉列表（dropdown），点击 Header 分支徽章即可弹出，简化分支切换 UX。

## What I already know

### 当前实现

1. **Header 徽章**（始终可见）：项目卡片头部显示当前分支名，pill 样式，`max-width: 90px` 超出截断
2. **可折叠分支列表**（展开项目后）：平铺展示所有本地分支（`ProjectItem.tsx:366-426`），当前分支蓝色+绿点，其余可点击切换
3. **Git 操作下拉菜单**（`ProjectItem.tsx:322-343`）：仅 "New Branch" / "New Worktree"
4. 分支切换是**单击直接 checkout，无确认**
5. 分支重命名通过**双击**触发，无可发现性提示
6. Worktree 占用的分支会被过滤隐藏（`ProjectItem.tsx:273-276`）
7. 分支逻辑在 `ProjectItem.tsx` 和 `RemoteItems.tsx` 之间**重复实现**

### 关键文件

- `src/components/project/ProjectItem.tsx` — 本地项目卡片，分支列表 + checkout + rename
- `src/components/connections/RemoteItems.tsx` — WSL/远程项目，重复的分支逻辑
- `src/styles.css` — `.gh-branch-inline` (line 985), `.gh-branch-item` (line 1408)
- `src-tauri/src/git/local.rs` — 后端 `get_git_info()`，仅 `BranchType::Local`

## Requirements

- [ ] 点击 Header 分支徽章弹出分支下拉列表
- [ ] 下拉列表顶部有搜索框，支持实时过滤
- [ ] 当前分支高标蓝 + 绿点，其他分支可点击 checkout
- [ ] 下拉列表中支持分支重命名（双击或右键菜单）
- [ ] 移除项目体内的展开式分支列表（`.gh-branch-list` 整块）
- [ ] 保留当前分支的 changed files 展示（移到项目体内，不依赖分支列表）
- [ ] 新建分支入口合并到下拉列表底部
- [ ] 下拉列表外点击自动关闭

## Acceptance Criteria

- [ ] 点击 Header 的 `.gh-branch-inline` 弹出下拉，显示所有本地分支（过滤 worktree 占用的）
- [ ] 搜索框输入后实时过滤分支名
- [ ] 当前分支行有蓝色文字 + 绿点，不可点击 checkout
- [ ] 非当前分支点击后触发 checkout
- [ ] 项目体展开后不再显示 Branches section，直接显示 changed files（如果有）
- [ ] 下拉底部有 "+ New Branch" 入口
- [ ] 不影响 WSL/Remote 的分支展示（本次只改本地）

## Decision (ADR-lite)

**Context**: 当前展开式分支列表在分支多时体验差，无搜索/过滤，且需要展开项目才能切换分支。
**Decision**: 用 Header 徽章触发的 dropdown 替代平铺列表。
**Consequences**: 切换分支更快（一步操作），但需要展开项目才能看到 changed files（可接受）。

## Out of Scope

- 远程分支展示（后端需要改动，独立任务）
- WSL/Remote 分支逻辑统一（RemoteItems.tsx 本次不动）
- 分支列表代码去重

## Technical Notes

- 项目 Header 区域已有 `gh-branch-inline`（`styles.css:985`）和 `gh-git-menu` dropdown（`ProjectItem.tsx:322-343`）的样式参考
- 可复用 `AddProjectModal.tsx` 中的 dropdown 模式（`.agent-selector` / `.agent-dropdown`）
- 当前分支展开后显示 changed files 的逻辑在 `ProjectItem.tsx:413-421`，需保留但不依赖分支列表
