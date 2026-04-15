# PR#7: Project 绑定标签组合与启动时自动加载

## 概述

这是 Skill 管理系统的最终集成 PR。实现每个 Project 绑定一个或多个标签组合（TagGroup），在项目启动/切换时按绑定的标签组合自动 sync/unsync 对应的 Skill 到 Agent 工具目录。

这是 Neeko 区别于 skills-manager 的核心差异——skills-manager 使用全局 active scenario，而 Neeko 实现**项目级别**的标签绑定，不同项目可以有不同的 Skill 组合。

## 依赖

- PR#1~PR#6: 所有前置功能

## 参考项目

- `skills-manager/src-tauri/src/commands/scenarios.rs` — `switch_scenario()` 的 sync/unsync 逻辑
- `skills-manager/src-tauri/src/commands/projects.rs` — 项目管理

## 需求

### 1. 数据模型扩展

#### SQLite 新增表（数据库迁移 v2）

```sql
-- 项目与标签组合绑定关系
CREATE TABLE IF NOT EXISTS project_tag_groups (
  project_id TEXT NOT NULL,
  tag_group_id TEXT NOT NULL REFERENCES tag_groups(id) ON DELETE CASCADE,
  added_at INTEGER NOT NULL,
  PRIMARY KEY (project_id, tag_group_id)
);
```

注意：`project_id` 不做外键约束（因为 Project 不在 SQLite 中管理，仍在 sessions.json 中）。

#### SkillStore 新增方法
- `set_project_tag_groups(project_id, tag_group_ids) -> Result<()>`
- `get_project_tag_groups(project_id) -> Result<Vec<String>>`
- `add_project_tag_group(project_id, tag_group_id) -> Result<()>`
- `remove_project_tag_group(project_id, tag_group_id) -> Result<()>`

#### TypeScript 类型扩展

```typescript
// types.ts Project 扩展（仅前端展示用，实际绑定关系在 SQLite 中）
// 无需修改 Project 接口，通过单独的 API 查询绑定关系
```

### 2. 后端 Tauri 命令

| 命令 | 参数 | 返回 | 说明 |
|------|------|------|------|
| `set_project_tag_groups` | `project_id, tag_group_ids: Vec<String>` | `()` | 设置绑定 |
| `get_project_tag_groups` | `project_id: String` | `Vec<TagGroupDto>` | 获取绑定 |
| `add_project_tag_group` | `project_id, tag_group_id` | `()` | 添加一个 |
| `remove_project_tag_group` | `project_id, tag_group_id` | `()` | 移除一个 |
| `switch_project_skills` | `old_project_id?, new_project_id` | `()` | 切换项目时 unsync 旧 + sync 新 |

### 3. 项目切换时的 Skill Sync 流程

```
用户选择项目 A → 项目 B
    │
    ▼
1. unsync 项目 A 的所有 TagGroup Skill
   (遍历 A 的绑定 tag_groups → unsync_tag_group_skills())
    │
    ▼
2. sync 项目 B 的所有 TagGroup Skill
   (遍历 B 的绑定 tag_groups → sync_tag_group_skills())
    │
    ▼
3. 更新 active_project_id
```

#### 应用启动时的 Skill 加载

```
应用启动 → load_session()
    │
    ▼
恢复 active_project_id
    │
    ▼
sync active project 的 TagGroup Skill
```

### 4. 前端 UI

#### SkillsPanel 扩展 — Project 绑定区域

在 SkillsPanel（PR#6 创建）顶部新增"当前项目"的 TagGroup 绑定信息：

```
┌─────────────────────────────┐
│ Skills               [+ ▼] │
├─────────────────────────────┤
│ 📂 my-app                  │  ← 当前活跃项目名
│ Tags: [Default] [后端架构师] │  ← 已绑定的 TagGroup（可编辑）
│ [+ Add Tag Group]           │
├─────────────────────────────┤
│ 🔍 Search skills...        │
│ ...（PR#6 的其余内容）       │
```

#### AddProjectModal 扩展
- 添加项目时可选择标签组合（多选 Select）
- 默认选中 "Default" 标签组

#### 项目切换 Hook 扩展

在 `useLocalProjects.ts` / `useWslProjects.ts` / `useRemoteProjects.ts` 的 setActiveProject 中：
- 调用 `switch_project_skills(old_project_id, new_project_id)` Tauri 命令
- 异步执行，不阻塞项目切换 UI

### 5. 性能考虑

- Sync/Unsync 操作异步执行，不阻塞项目切换
- 多个 TagGroup 的 Skill 可能重叠，sync 时去重（同一 Skill 不重复部署）
- 大量 Skill 部署时使用批量操作

## 验收标准

- [ ] SQLite 迁移 v2 正确（project_tag_groups 表）
- [ ] Project 可绑定多个 TagGroup（数据存在 SQLite）
- [ ] 切换项目时自动 unsync 旧 → sync 新 TagGroup Skill
- [ ] 应用启动时自动加载 active project 的 Skill
- [ ] SkillsPanel 显示当前项目绑定的 TagGroup
- [ ] AddProjectModal 支持选择 TagGroup
- [ ] WSL/SSH 项目同样支持标签绑定
- [ ] Sync/Unsync 异步执行不阻塞 UI
- [ ] 重叠 Skill 不重复部署
- [ ] `cargo check` 和 `npx tsc --noEmit` 通过
- [ ] 端到端流程：安装 Skill → 创建 TagGroup → 绑定到 Project → 切换 Project → 验证工具目录

## 不包含

- 不包含 WSL/SSH 项目的 Skill 远程部署（Skill 仅部署到本地工具目录）
- 不包含 Skill 执行能力（可未来扩展，参考设计文档的 SkillExecuteDialog）
- 不包含 TitleBar Skill Selector 快速入口
