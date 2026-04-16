# PR#11: Tag Group management UI — CRUD, skill assignment, reorder

## 概述

完善 Tag Group（标签组合）的管理 UI。Tag Group 是 Skill 的组合标签（如"设计师"、"后端架构师"），不同 Project 可以绑定不同的 Tag Group 来加载不同的 Skill 组合。

## 依赖

- PR#10: Skill detail 面板（提供 tool toggle 基础）

## 参考项目

- `skills-manager/src/components/Sidebar.tsx` — Scenario 列表和 DnD 排序
- `skills-manager/src/components/CreateScenarioDialog.tsx` — 创建对话框 + icon 选择

## 需求

### 1. Tag Group 列表增强

当前 TagGroupSection 只展示名称和数量，需要增强：

```
┌──────────────────────────────────────┐
│ 🏷️ Tag Groups              [+ New] │
├──────────────────────────────────────┤
│ ┌────────────────────────────────┐   │
│ │ 📋 Default (5 skills)    [⋯]  │   │  ← 活跃高亮
│ └────────────────────────────────┘   │
│ ┌────────────────────────────────┐   │
│ │ 🎨 设计师 (3 skills)     [⋯]  │   │
│ └────────────────────────────────┘   │
│ ┌────────────────────────────────┐   │
│ │ 🔧 后端架构师 (8 skills)  [⋯]  │   │
│ └────────────────────────────────┘   │
└──────────────────────────────────────┘
```

#### Tag Group 操作菜单 [⋯]

- **Edit** — 弹出编辑对话框（名称/描述/图标）
- **Manage Skills** — 展开 Skill 分配视图
- **Sync** — 将该 TagGroup 的所有 Skill sync 到工具目录
- **Unsync** — 移除该 TagGroup 的所有 Skill
- **Delete** — 删除（确认弹窗，"Default" 组不允许删除）

### 2. 创建 Tag Group 对话框

```
┌──────────────────────────────────┐
│ Create Tag Group                 │
├──────────────────────────────────┤
│ Icon: [📋] (emoji picker)       │
│ Name:  [________________]       │
│ Desc:  [________________]       │
│                                  │
│           [Cancel] [Create]      │
└──────────────────────────────────┘
```

- 调用 `create_tag_group(name, description, icon)`
- Icon 使用 emoji 选择器（可简化为文本输入）

### 3. 编辑 Tag Group 对话框

- 调用 `update_tag_group_cmd(id, name, description, icon)`
- 预填当前值

### 4. Skill 分配视图

选中某个 Tag Group 后，展示哪些 Skill 属于该组：

```
┌──────────────────────────────────────┐
│ 🎨 设计师 — Skills                  │
├──────────────────────────────────────┤
│ ☑ ui-ux-pro-max                     │  ← 已分配
│ ☑ web-design-guidelines             │
│ ☐ shadcn                            │  ← 未分配
│ ☐ vercel-react-best-practices       │
│ ...                                  │
├──────────────────────────────────────┤
│ [Sync to Tools]  [Unsync from Tools] │
└──────────────────────────────────────┘
```

- 展示所有 managed skills，checkbox 表示是否在当前 TagGroup 中
- 勾选 → `add_skill_to_tag_group_cmd(tag_group_id, skill_id)`
- 取消勾选 → `remove_skill_from_tag_group_cmd(tag_group_id, skill_id)`
- "Sync" → `sync_tag_group_cmd(tag_group_id)` — 将组内所有 skill sync 到已安装的 Agent 工具目录
- "Unsync" → `unsync_tag_group_cmd(tag_group_id)` — 移除 sync

### 5. Tag Group 排序

- 支持拖拽排序（使用 `@dnd-kit/sortable`，参考 skills-manager 的 Sidebar）
- 或简化为上移/下移按钮
- 调用 `reorder_tag_groups_cmd(ids)`

### 6. useTagGroups Hook 增强

当前 hook 只有 `loadTagGroups`, `createGroup`, `deleteGroup`。需要添加：

```typescript
// 新增方法
updateGroup: (id: string, name: string, description?: string, icon?: string) => Promise<void>
reorderGroups: (ids: string[]) => Promise<void>
addSkillToGroup: (tagGroupId: string, skillId: string) => Promise<void>
removeSkillFromGroup: (tagGroupId: string, skillId: string) => Promise<void>
getSkillsForGroup: (tagGroupId: string) => Promise<ManagedSkillDto[]>
syncGroup: (tagGroupId: string) => Promise<void>
unsyncGroup: (tagGroupId: string) => Promise<void>
```

## 验收标准

- [ ] Tag Group 列表展示 icon + 名称 + skill 数量
- [ ] "New" 按钮创建 Tag Group
- [ ] [⋯] 菜单支持编辑/管理/sync/unsync/删除
- [ ] Skill 分配视图正确显示已分配/未分配
- [ ] Checkbox 勾选/取消正确调用后端
- [ ] Sync/Unsync 操作正常（验证 Agent 工具目录）
- [ ] Default Tag Group 不允许删除
- [ ] `cargo check` + `npx tsc --noEmit` 通过

## 不包含

- DnD 排序（如实现复杂可推迟）
- Project 绑定（PR#14）
