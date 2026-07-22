# 项目 Skill 同步契约

## 场景：Project Tag Group、target Agent 与项目本地 Skill 同步

### 1. Scope / Trigger

- Trigger：Project Skills 同时跨越 React UI、Tauri IPC、Agent 配置、Skill repository 和文件系统，且变更了 `apply_project_skills_cmd` 的目标语义。
- Scope：项目绑定查询/计数、项目选择时 apply、绑定新增部署、解绑独占 Skill 删除、手动 Import/Remove 与 target record。
- Boundary：项目绑定同步只允许写入项目根目录下的 Agent Skill 目录；全局 `~/.agent/skills` 只属于全局 Tag Group sync，不是项目绑定 fallback。

### 2. Signatures

```rust
apply_project_skills_cmd(
    project_id: String,
    state: State<'_, AppStateWrapper>,
) -> Result<(), AppError>

get_all_project_tag_group_counts(
    store: State<'_, Arc<SkillStore>>,
) -> Result<Vec<ProjectTagGroupCountDto>, AppError>

set_project_tag_groups_cmd(
    project_id: String,
    tag_group_ids: Vec<String>,
    store: State<'_, Arc<SkillStore>>,
) -> Result<(), AppError>

import_skills_to_project_cmd(
    project_path: String,
    skill_ids: Vec<String>,
    agent_ids: Vec<String>,
    state: State<'_, AppStateWrapper>,
) -> Result<u32, AppError>

remove_skill_from_project_cmd(
    project_path: String,
    skill_name: String,
    agent_ids: Option<Vec<String>>,
    skill_id: Option<String>,
    state: State<'_, AppStateWrapper>,
) -> Result<(), AppError>
```

```typescript
interface ProjectTagGroupCount {
  project_id: string;
  group_count: number;
}
```

### 3. Contracts

#### Target resolution

1. `project_id` 必须对应已加载项目。
2. 项目 `selected_agent` 必须是非空字符串。
3. Agent 必须存在于 `AgentManager`，且 `skill_path` 必须非空。
4. `project_agent_skills_dir` 将内置 adapter 或 Agent 路径映射为项目相对目录。
5. 最终目录必须满足 `skills_dir.starts_with(project_path)`。
6. 任一 target 条件不满足时，`apply_project_skills_cmd` 返回 `Ok(())`，绑定声明保持不变且不写磁盘。

#### Apply

- 查询项目绑定组，合并组内 Skill，并按 `skill.id` 去重。
- 仅部署到解析出的单个 target Agent 目录。
- install-only：不会删除不在当前绑定集合内的其他项目 Skill。
- 每个成功部署更新 `SkillTargetRecord`，tool key 为项目路径和 Agent ID 的组合。

#### Binding reconciliation

- `set_project_tag_groups_cmd` 原子替换 DB 声明集合。
- UI 只将新增组 Skill 传给 `import_skills_to_project_cmd`，且 `agent_ids` 为 target Agent 单元素数组。
- 解绑时以所有保留组 Skill 的 ID/名称集合做差；仅对不再被覆盖的 Skill 调用 remove。
- 同一 Skill 同时存在于已解绑组与保留组时必须保留。

#### Count response

- `get_all_project_tag_group_counts` 只返回至少有一个绑定的项目。
- 前端对缺失 `project_id` 按 `group_count = 0` 处理。
- `group_count` 是声明层 Tag Group 数，不是项目磁盘 Skill 数。

### 4. Validation & Error Matrix

| 条件 | 命令 | 结果 |
|------|------|------|
| `project_id` 不存在 | `apply_project_skills_cmd` | `AppError::NotFound` |
| `selected_agent` 缺失/空 | `apply_project_skills_cmd` | `Ok(())`，零写入 |
| Agent 不存在 | `apply_project_skills_cmd` | `Ok(())`，零写入 |
| Agent `skill_path` 缺失/空 | `apply_project_skills_cmd` | `Ok(())`，零写入 |
| 无绑定组 | `apply_project_skills_cmd` | `Ok(())`，零写入 |
| 有绑定和合法 target，但项目目录不存在 | `apply_project_skills_cmd` | `AppError::NotFound` |
| `skill_ids` 为空 | `import_skills_to_project_cmd` | `AppError::InvalidInput` |
| `agent_ids` 为空 | `import_skills_to_project_cmd` | `AppError::InvalidInput` |
| Agent ID 不存在 | `import_skills_to_project_cmd` | `AppError::NotFound` |
| Skill ID/central path 不存在 | `import_skills_to_project_cmd` | `AppError::NotFound` |
| Agent 无可映射项目目录 | Import/Remove | 跳过该 Agent，不写全局目录 |
| count 查询无绑定 | `get_all_project_tag_group_counts` | `Ok([])` |

### 5. Good/Base/Bad Cases

- **Good**：项目 target 为 `claude-code`，`skill_path = ~/.claude/skills`，绑定 Backend + Shared；Skill 部署到 `<project>/.claude/skills/*`，全局路径和其他 Agent 目录不变。
- **Base**：项目没有 target Agent；绑定保存成功，左侧组数更新，磁盘 Skill 数不变。
- **Good unbind**：Skill A 只属于被移除组，Skill B 同时属于保留组；只删除 Skill A。
- **Bad**：把 `resolve_sync_targets` 的所有全局 Agent target 传给项目 apply，导致项目绑定扇出到 `~/.agent/skills`。
- **Bad**：解绑时直接删除被移除组所有 Skill，导致仍由其他绑定组提供的共享 Skill 丢失。

### 6. Tests Required

- Repository unit：多个项目 GROUP BY 计数正确；无绑定返回空数组。
- Rust filesystem：selected Agent 只创建项目本地目录和 Skill；全局 selected/other Agent 路径不存在；其他项目 Agent 目录不变。
- Rust filesystem：无 selected Agent、无 Agent 或空 `skill_path` 时 target 为 `None`，项目目录无新条目。
- Frontend component：绑定新增只调用 target Agent；无 target 不调用 Import。
- Frontend component：解绑独占 Skill 调用 Remove；保留组共享 Skill不调用 Remove。
- Frontend component：无 `skill_path` Agent 不出现在 target 菜单。
- Frontend rail：批量 count 缺失项目显示 0，磁盘数和组数语义不混用。

### 7. Wrong vs Correct

#### Wrong

```rust
let targets = resolve_sync_targets(state.inner());
sync_skills_to_targets(&store, &skills, &targets, mode);
```

该写法把项目绑定 Skill 扇出到全局 Agent 目录，破坏项目隔离。

#### Correct

```rust
let Some((agent_id, skills_dir)) = resolve_project_skill_target(
    &project,
    selected_agent.as_deref(),
    agent_skill_path.as_deref(),
) else {
    return Ok(());
};

for (skill_id, target) in deploy_project_skills(&skills_dir, &skills) {
    // record project-local target
}
```

target 由项目、`selected_agent` 和非空 `skill_path` 共同决定；解析失败时 no-op，绝不回退到全局路径。
