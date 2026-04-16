# PR#14: Project Skill panel — tag binding, installed skills, install/uninstall

## 概述

实现 SkillsPanel 的"项目 Skill"Tab。展示当前活跃 Project 关联的 Tag Group 分组，以及通过这些 Tag Group 安装到 Agent 工具目录的 Skill 列表。支持绑定/解绑 TagGroup，以及直接安装/卸载 Skill。

这是 Neeko 区别于 skills-manager 的核心差异——实现**项目级别**的标签绑定。

## 依赖

- PR#7: project_tag_groups 数据表 + 后端命令
- PR#11: Tag Group 管理 UI
- PR#9: Tab 布局

## 参考项目

- `skills-manager/src/views/ProjectDetail.tsx` — 项目 Skill 管理
- `skills-manager/src-tauri/src/commands/projects.rs` — 项目命令

## 需求

### 1. 项目 Skill Tab 布局

```
┌──────────────────────────────────────┐
│ [本地 Skill] [Skill 市场] [项目 Skill] │
├──────────────────────────────────────┤
│ 📂 my-tauri-app                      │  ← 当前活跃项目
│ No project selected                  │  ← 无活跃项目时提示
├──────────────────────────────────────┤
│ 🏷️ Tag Groups                       │
│ ┌────────────────────────────────┐   │
│ │ ☑ Default (5 skills)          │   │  ← 已绑定
│ │ ☑ 后端架构师 (3 skills)        │   │  ← 已绑定
│ │ ☐ 设计师 (4 skills)           │   │  ← 未绑定
│ └────────────────────────────────┘   │
├──────────────────────────────────────┤
│ 📦 Active Skills (8)                 │
│ ┌────────────────────────────────┐   │
│ │ vercel-react-best-practices   │   │
│ │ shadcn                         │   │
│ │ ...                            │   │
│ └────────────────────────────────┘   │
├──────────────────────────────────────┤
│ [Sync All]  [Unsync All]            │
└──────────────────────────────────────┘
```

### 2. Tag Group 绑定

- 展示所有 Tag Groups，checkbox 表示是否绑定到当前 project
- 勾选 → `add_project_tag_group_cmd(project_id, tag_group_id)`
- 取消勾选 → `remove_project_tag_group_cmd(project_id, tag_group_id)`
- 从 `get_project_tag_groups_cmd(project_id)` 获取当前绑定

### 3. Active Skills 列表

展示通过绑定的 Tag Groups 汇总的所有 Skill（去重）：

- 遍历 project 绑定的所有 tag_group_ids
- 对每个 tag_group 调用 `get_skills_for_tag_group_cmd(tag_group_id)`
- 合并去重后展示

每个 Skill 行显示：
- Skill 名称
- 来源 Tag Group（可能属于多个）
- Sync 状态标识

### 4. Sync / Unsync 操作

- **Sync All** — 遍历绑定的所有 Tag Group，调用 `sync_tag_group_cmd(tag_group_id)`
- **Unsync All** — 遍历所有 Tag Group，调用 `unsync_tag_group_cmd(tag_group_id)`

### 5. `useProjectSkills` Hook

```typescript
export function useProjectSkills(projectId: string | null) {
  const [boundGroups, setBoundGroups] = useState<string[]>([]);
  const [activeSkills, setActiveSkills] = useState<ManagedSkillDto[]>([]);
  const [loading, setLoading] = useState(false);

  const loadBoundGroups: () => Promise<void>;
  const bindTagGroup: (tagGroupId: string) => Promise<void>;
  const unbindTagGroup: (tagGroupId: string) => Promise<void>;
  const syncAll: () => Promise<void>;
  const unsyncAll: () => Promise<void>;

  return { boundGroups, activeSkills, loading,
           loadBoundGroups, bindTagGroup, unbindTagGroup, syncAll, unsyncAll };
}
```

### 6. 项目切换响应

当用户在 ProjectSidebar 切换活跃项目时，项目 Skill Tab 自动刷新：
- SkillProvider 监听 `activeProjectId` prop 变化
- 重新加载 bound groups 和 active skills

### 7. 无项目提示

当没有活跃项目时（`activeProjectId === null`），显示友好提示：

```
┌──────────────────────────────────────┐
│ 📂 No project selected              │
│                                      │
│ Select a project from the sidebar    │
│ to manage its skills.                │
└──────────────────────────────────────┘
```

## 验收标准

- [ ] "项目 Skill"Tab 展示当前项目名称
- [ ] Tag Group 列表正确显示绑定状态
- [ ] Checkbox 绑定/解绑操作正常
- [ ] Active Skills 列表正确汇总去重
- [ ] Sync All / Unsync All 按钮功能正常
- [ ] 切换项目后自动刷新
- [ ] 无项目时显示提示
- [ ] `cargo check` + `npx tsc --noEmit` 通过

## 不包含

- 项目级别的 per-skill tool toggle（复杂度过高，可后续扩展）
- 自动 sync on project switch（PR#15）
