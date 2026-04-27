# PR#15: Auto sync/unsync skills on project switch and app startup

## 概述

这是 Skill 管理系统的最终集成 PR。实现：
1. **项目切换时** — 自动 unsync 旧项目的 Skill + sync 新项目的 Skill
2. **应用启动时** — 自动加载活跃项目绑定的 Skill 到 Agent 工具目录
3. **应用退出时** — 可选：清理所有 synced Skill

## 依赖

- PR#14: 项目 Skill 面板（提供 project ↔ tag group 绑定）
- PR#5: Sync Engine（执行实际的 sync/unsync 操作）

## 参考项目

- `skills-manager/src-tauri/src/commands/scenarios.rs` — `switch_scenario()` 的 sync/unsync 逻辑

## 需求

### 1. 后端新增命令

```rust
/// 切换项目时自动 sync/unsync
#[tauri::command]
pub async fn switch_project_skills(
    old_project_id: Option<String>,
    new_project_id: String,
    store: State<'_, Arc<SkillStore>>,
) -> Result<(), String>
```

流程：
```
1. IF old_project_id 存在:
   a. 获取 old project 绑定的 tag_group_ids
   b. 对每个 tag_group:
      - 获取 tag_group 内的所有 skill
      - 对每个 skill：unsync_tag_group 的 skill targets
   
2. 获取 new project 绑定的 tag_group_ids
3. 收集所有 skill（去重）
4. 对每个 skill + 每个已安装 tool:
   - sync_skill(central_path → tool_skills_dir/name)
   - 记录 skill_targets
```

#### 去重逻辑

多个 Tag Group 可能包含同一个 Skill：
- Sync 时：收集所有 unique skill_ids，每个只 sync 一次
- Unsync 时：只 unsync 不在新项目 Tag Group 中的 skill（避免切换时闪烁）

### 2. 启动时自动 Sync

在 `lib.rs` 的 `setup()` hook 中，恢复 active project 后自动 sync：

```rust
// 在 setup() 中，session 恢复后
if let Some(active_project_id) = &session.active_project_id {
    let store = state.skill_store.clone();
    let project_id = active_project_id.clone();
    // 异步执行，不阻塞启动
    tauri::async_runtime::spawn(async move {
        if let Err(e) = sync_project_skills(&store, &project_id) {
            log::warn!("Failed to sync skills on startup: {e}");
        }
    });
}
```

### 3. 前端项目切换 Hook 集成

在 `useLocalProjects.ts` / `useWslProjects.ts` / `useRemoteProjects.ts` 的 `setActiveProject` 中：

```typescript
const setActiveProject = useCallback(async (projectId: string) => {
  const oldId = activeProjectId;
  // ... 现有的 setActive 逻辑 ...
  
  // 异步触发 skill sync（不阻塞 UI）
  invoke("switch_project_skills", {
    old_project_id: oldId,
    new_project_id: projectId,
  }).catch(err => {
    console.warn("Failed to switch project skills:", err);
  });
}, [activeProjectId]);
```

### 4. 优化：差异化 Sync

当旧项目和新项目有共同的 Tag Group 时，不需要 unsync 再 sync 共同的 Skill：

```
Old project: [Default, 后端架构师]
New project: [Default, 设计师]

→ 不变: Default 的 skill 不动
→ Unsync: 后端架构师 独有的 skill
→ Sync: 设计师 独有的 skill
```

### 5. 错误处理

- Sync 失败不影响项目切换（异步 + catch）
- 单个 Skill sync 失败不影响其他（逐个 try）
- 记录 last_error 到 skill_targets 表

### 6. 性能考虑

- 全部 sync/unsync 操作在 `spawn_blocking` 中执行
- 多个 Skill 的 sync 串行执行（避免文件系统竞争）
- 启动时 sync 异步执行，不阻塞 UI 显示

## 验收标准

- [ ] 切换项目时自动 unsync 旧 + sync 新
- [ ] 应用启动时自动 sync 活跃项目的 Skill
- [ ] 共同 Tag Group 的 Skill 在切换时不会闪烁（差异化 sync）
- [ ] Sync 失败不阻塞项目切换
- [ ] 所有三种项目类型（本地/WSL/SSH）都支持 skill 切换
- [ ] `cargo check` + `npx tsc --noEmit` 通过
- [ ] 端到端：安装 Skill → 创建 Tag Group → 分配 Skill → 绑定到 Project → 切换 Project → 验证工具目录变化

## 不包含

- 退出时自动清理（可选功能，后续扩展）
- 热重载（修改 Tag Group 后自动 re-sync，可后续扩展）
- WSL/SSH 远程 Skill 部署（Skill 仅部署到本地 Agent 工具目录）
