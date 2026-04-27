# PR#4: 标签组合系统（Skill Tag Group）

## 概述

实现 Skill 标签组合管理功能。用户可以创建自定义角色标签（如"设计师"、"后端架构师"、"全栈开发"），将多个 Skill 组合到不同标签下。项目启动时可以根据绑定的标签组合加载对应的 Skill 集合。

这是 Neeko 项目的核心差异化功能——对应 skills-manager 的 Scenario 概念，但做了以下定制化改造：
- **不需要全局 active scenario 切换**，改为 Project 级别绑定（PR#7）
- **标签而非场景**：面向应用场景自定义，语义更灵活

## 依赖

- PR#1: 数据模型（TagGroup 结构体）
- PR#2: SkillStore SQLite 持久化

## 参考项目

- `skills-manager/src-tauri/src/commands/scenarios.rs` — Scenario CRUD + Skill 关联
- `skills-manager/src-tauri/src/core/skill_store.rs` — Scenario 相关 SQLite 操作
- `skills-manager/src/components/CreateScenarioDialog.tsx` — 创建场景 UI
- `skills-manager/src/lib/scenarioIcons.tsx` — 场景图标选项

## 需求

### 1. SkillStore 扩展（SQLite 表已在 PR#2 迁移中创建）

#### TagGroup CRUD
- `insert_tag_group(tag_group: &TagGroupRecord) -> Result<()>`
- `get_all_tag_groups() -> Result<Vec<TagGroupRecord>>`
- `update_tag_group(id, name, description?, icon?) -> Result<()>`
- `delete_tag_group(id: &str) -> Result<()>`
- `reorder_tag_groups(ids: &[String]) -> Result<()>`

#### Skill-TagGroup 关联
- `add_skill_to_tag_group(tag_group_id, skill_id) -> Result<()>`
- `remove_skill_from_tag_group(tag_group_id, skill_id) -> Result<()>`
- `get_skill_ids_for_tag_group(tag_group_id) -> Result<Vec<String>>`
- `get_skills_for_tag_group(tag_group_id) -> Result<Vec<SkillRecord>>`
- `count_skills_for_tag_group(tag_group_id) -> Result<i64>`
- `get_tag_groups_for_skill(skill_id) -> Result<Vec<String>>`
- `reorder_tag_group_skills(tag_group_id, skill_ids) -> Result<()>`

#### 工具开关（细粒度控制）
- `ensure_tag_group_skill_tool_defaults(tag_group_id, skill_id, tools) -> Result<()>`
- `set_tag_group_skill_tool_enabled(tag_group_id, skill_id, tool, enabled) -> Result<()>`
- `get_tag_group_skill_tool_toggles(tag_group_id, skill_id) -> Result<Vec<ToolToggleRecord>>`
- `get_enabled_tools_for_tag_group_skill(tag_group_id, skill_id) -> Result<Vec<String>>`

### 2. Tauri 命令

| 命令 | 参数 | 返回 | 说明 |
|------|------|------|------|
| `get_tag_groups` | — | `Vec<TagGroupDto>` | 获取所有标签组合（含 skill_count）|
| `create_tag_group` | `name, description?, icon?` | `TagGroupDto` | 创建标签组 |
| `update_tag_group` | `id, name, description?, icon?` | `()` | 更新 |
| `delete_tag_group` | `id: String` | `()` | 删除 |
| `reorder_tag_groups` | `ids: Vec<String>` | `()` | 排序 |
| `add_skill_to_tag_group` | `tag_group_id, skill_id` | `()` | 添加 |
| `remove_skill_from_tag_group` | `tag_group_id, skill_id` | `()` | 移除 |
| `get_skills_for_tag_group` | `tag_group_id: String` | `Vec<ManagedSkillDto>` | 查询 |
| `reorder_tag_group_skills` | `tag_group_id, skill_ids` | `()` | 排序 |
| `get_all_tags` | — | `Vec<String>` | 所有标签 |
| `set_skill_tags` | `skill_id, tags: Vec<String>` | `()` | 设置标签 |
| `get_skill_tool_toggles` | `tag_group_id, skill_id` | `Vec<SkillToolToggleDto>` | 工具开关 |
| `set_skill_tool_toggle` | `tag_group_id, skill_id, tool, enabled` | `()` | 设置 |

### 3. 首次运行自动创建 Default 标签组

参考 skills-manager 的 `auto-create Default scenario`：
- 系统首次启动时，若无任何 TagGroup，自动创建一个 "Default"
- 后续新安装的 Skill 可选择性自动添加到 Default

## 验收标准

- [ ] TagGroup CRUD 完整实现（SQLite）
- [ ] Skill-TagGroup 多对多关联正确
- [ ] 删除 TagGroup 时清理关联（不删除 Skill 本身）
- [ ] 删除 Skill 时自动从所有 TagGroup 中移除（CASCADE）
- [ ] 工具开关（tool toggle）功能正确
- [ ] 首次运行自动创建 Default 标签组
- [ ] 拖拽排序持久化
- [ ] 所有 Tauri 命令可调用
- [ ] `cargo check` 通过
- [ ] 核心逻辑有单元测试

## 不包含

- 不包含 Project 绑定标签组的逻辑（PR#7）
- 不包含标签组合的 Sync/Deploy 执行（PR#5）
- 不包含前端 UI（PR#6）
