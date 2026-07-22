# Design: Project UI — tag-group ↔ skill relations

## Architecture / Boundaries

```text
SkillsPanel                 ProjectSkillContent                  Rust Skill domain
-----------                 -------------------                  -----------------
project disk/group counts   bound groups + filters               repository counts
exclusive rail selection    target Agent selector      IPC       project-local deploy
agent count summaries       Skill/Agent controls      ----->     remove/enable/import
                            binding reconciliation               target records
```

- **Domain owner**：`features/skill` 负责 UI、Zustand store 和 Skill IPC wrapper。
- **Project source**：只读 `useProjectStore` 的项目列表和当前项目；target Agent 更新通过 Agent API 后同步 project store 快照。
- **Backend owner**：`src-tauri/src/skill` 负责绑定查询、计数、项目目录解析、部署和 target record。
- **Schema**：沿用 `project_tag_groups` 与 `tag_group_skills`，不新增迁移。

## Data Flow

### 1. 左侧双计数

1. `SkillsPanel` mount 或项目集合变化。
2. 并行调用 `get_all_project_skill_counts` 与 `get_all_project_tag_group_counts`。
3. store 分别更新 `projectSkillCounts`、`projectTagGroupCounts` 两个 `Map`。
4. 项目行渲染 `{diskCount} · {groupCount}g`；API 未返回的项目按 0 展示。

### 2. 选中项目

1. 项目 rail 点击清除 active Tag/Agent，设置 `activeSkillView = project`。
2. `ProjectSkillContent` 加载磁盘 Skill、绑定组、Library Skill、Tag Group 和 Agent。
3. `useApplyProjectSkills` 调用 `apply_project_skills_cmd(project_id)`。
4. 后端读取项目与 `selected_agent`，解析项目本地目录；缺少合法 target 时返回成功且不写盘。
5. 有 target 时对所有绑定组 Skill 去重并 install-only 部署。

### 3. 保存绑定

前端在保存前计算差集：

```text
addedGroups   = nextBindings - previousBindings
removedGroups = previousBindings - nextBindings
remainingKeys = union(skills(nextBindings))
removeSkills  = skills(removedGroups) - remainingKeys
```

执行顺序：

1. 调用 `set_project_tag_groups_cmd` 持久化声明。
2. 对 `removeSkills` 调用 `remove_skill_from_project_cmd`，只处理实际关联的项目 Agent 目录。
3. 将 `addedGroups` 的 Skill ID 去重后调用 `import_skills_to_project_cmd`，Agent 参数严格为当前 target Agent 单元素数组。
4. 无 target Agent 时跳过步骤 3，但绑定保存成功并提示用户。
5. 有磁盘变更时刷新右侧列表、项目磁盘计数和 Agent 计数。

该顺序保证 DB 声明先成为事实源；后续单个磁盘操作失败会记录错误并保留可重试状态，不会将全局目录作为 fallback。

### 4. Project Skill Agent 控制

- 卡片将已关联 Agent 排在前面，随后显示具有非空 `skill_path` 的未关联 Agent。
- 未关联 Agent 的“添加”调用 `import_skills_to_project_cmd`。
- 已关联 Agent 的 toggle 调用 `set_project_skill_agent_enabled_cmd`。
- target Agent 仅做视觉高亮，不改变每个 Agent 控件的独立状态。

### 5. Agents 多选

- 多选模式是显式本地 UI 状态，不与普通卡片打开行为混用。
- 选择集合使用 Skill 磁盘路径作为稳定键。
- “全选”仅作用于当前过滤结果；批量删除逐项调用现有 remove API，汇总成功/失败数量后刷新共享 Agent store。

## IPC Contracts

| IPC | 用途 |
|-----|------|
| `get_all_project_tag_group_counts() -> [{project_id, group_count}]` | 批量左侧绑定组数 |
| `get_project_tag_groups_cmd(project_id) -> TagGroupDtoOut[]` | 当前项目绑定详情 |
| `set_project_tag_groups_cmd(project_id, tag_group_ids) -> ()` | 原子替换声明集合 |
| `apply_project_skills_cmd(project_id) -> ()` | 选中项目时向 target Agent install-only |
| `import_skills_to_project_cmd(project_path, skill_ids, agent_ids) -> u32` | 手动/绑定新增部署 |
| `remove_skill_from_project_cmd(...) -> ()` | 手动删除或解绑独占 Skill 清理 |

完整路径、验证和错误矩阵见 `.trellis/spec/backend/project-skill-sync.md`。

## UI Structure

- 项目行：头像、项目名、磁盘数、绑定组数与组合 tooltip。
- Project header：项目名、磁盘/启用数、target Agent 菜单、项目路径。
- Bound Tag Groups：All groups、组 chip、Skill 数、Manage。
- Toolbar：搜索、状态筛选、Agent 筛选、视图切换、Add Skill。
- Project Skill 卡片：绑定组、Library 状态、Agent 添加/启停、target 高亮。
- Agents toolbar：List 后的多选开关；开启后显示选择数、全选、清空、删除。

## Compatibility

| 现有能力 | 最终行为 |
|----------|----------|
| Add Skill / Import | 继续写项目本地 Agent 目录 |
| project switch apply | 改为 selected-Agent-only，不再全局扇出 |
| Remove / enable / disable | 保留，并扩展到每个 Agent 控制 |
| BindTagGroupsDialog | 正式挂载到 Project Skills |
| Tag Group global sync | 保持原有全局 Agent 同步语义，不与项目绑定同步混用 |

## Trade-offs

| 选择 | 取舍 |
|------|------|
| 前端计算绑定差集 | 复用现有原子 IPC，避免 schema/命令膨胀；磁盘同步不是单一事务 |
| target 必须有 `skill_path` | 前后端契约明确，无隐式全局 fallback；旧无效 target 需重新选择 |
| 解绑按剩余组去重 | 防止共享 Skill 误删；保存时需要额外读取组成员 |
| 批量组数 API | 增加一个只读 IPC，消除项目列表 N+1 invoke |

## Rollback

- UI/store/API 和 Rust 命令可随提交整体回滚；DB schema 未变。
- 回滚不会删除已有 `project_tag_groups` 数据。
- 项目本地部署为 symlink/copy，可通过现有 Remove 操作清理。

## Testing Strategy

- **Frontend**：SkillsPanel 双计数与 rail 互斥；ProjectSkillContent 绑定、差集删除、共享 Skill 保留、target-only import、无 target no-op、筛选、Agent 控制；AgentSkillContent 多选与批量删除。
- **Backend**：repository GROUP BY；项目 target 解析；临时目录部署不触及全局或其他 Agent 目录；缺少 target 不写盘。
- **Cross-layer**：TypeScript 类型检查、Rust check、Skill 范围测试和全量 Rust 测试。
- **UI runtime**：Vite 可启动并提供静态前端；原生 IPC 交互以 Vitest mock 与 Rust 测试验证，浏览器单独打开不能替代 Tauri runtime。
