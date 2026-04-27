# PR#8: Fix Skill command registration and state injection

## 概述

当前所有 24 个 Skill Tauri 命令虽已定义在 `skill/commands.rs`，但存在两个关键问题导致前端完全无法调用：

1. **命令未注册**：`lib.rs` 的 `invoke_handler(tauri::generate_handler![...])` 中没有列出任何 `skill::commands::*` 函数
2. **State 类型不匹配**：命令使用 `State<'_, Arc<SkillStore>>`，但 Tauri 管理的是 `AppStateWrapper`，不是独立的 `Arc<SkillStore>`

这是 P0 级别的阻塞问题，必须首先修复。

## 依赖

- PR#1~PR#7: 所有已完成的 Skill 基础设施

## 需求

### 1. 修复 State 注入

两种方案（选择 A）：

**方案 A（推荐）：独立 manage Arc<SkillStore>**
```rust
// lib.rs
let skill_store = Arc::new(SkillStore::new(&skill::central_repo::db_path())?);
tauri::Builder::default()
    .manage(skill_store.clone())  // 单独 manage
    .manage(AppStateWrapper::new_with_skill_store(skill_store))
```

**方案 B：修改所有命令使用 AppStateWrapper**
```rust
// 每个命令改为
store: State<'_, AppStateWrapper>
// 然后 store.skill_store.xxx()
```

方案 A 更干净，不需要修改 24 个命令签名。

### 2. 注册所有 Skill 命令

在 `invoke_handler` 中添加所有 24 个命令：

```rust
.invoke_handler(tauri::generate_handler![
    // ... existing commands ...
    // ─── Skill 命令 ────────────────────────────────────────────
    skill::commands::get_managed_skills,
    skill::commands::get_skill_document,
    skill::commands::delete_managed_skill,
    skill::commands::get_tool_status,
    skill::commands::get_tag_groups,
    skill::commands::create_tag_group,
    skill::commands::delete_tag_group_cmd,
    skill::commands::install_local_skill,
    skill::commands::scan_local_skills,
    skill::commands::import_discovered_skill,
    skill::commands::update_tag_group_cmd,
    skill::commands::reorder_tag_groups_cmd,
    skill::commands::add_skill_to_tag_group_cmd,
    skill::commands::remove_skill_from_tag_group_cmd,
    skill::commands::get_skills_for_tag_group_cmd,
    skill::commands::get_all_tags_cmd,
    skill::commands::set_skill_tags_cmd,
    skill::commands::set_skill_tool_toggle_cmd,
    skill::commands::sync_tag_group_cmd,
    skill::commands::unsync_tag_group_cmd,
    skill::commands::get_project_tag_groups_cmd,
    skill::commands::set_project_tag_groups_cmd,
    skill::commands::add_project_tag_group_cmd,
    skill::commands::remove_project_tag_group_cmd,
])
```

### 3. 修复 AppStateWrapper 初始化

确保 `skill_store` 在 `AppStateWrapper` 中正确初始化并且同一实例也被独立 manage。

### 4. 验证前端可调用

修复后，确保前端 hooks (`useSkillData`, `useTagGroups`, `useSkillInstall`, `useToolStatus`) 能正确调用后端命令。

## 验收标准

- [ ] 所有 24 个 skill 命令注册在 `invoke_handler` 中
- [ ] `State<'_, Arc<SkillStore>>` 正确注入（前端 invoke 不报 state not managed 错误）
- [ ] `cargo check` 通过
- [ ] `cargo test --lib skill` 通过
- [ ] `npx tsc --noEmit` 通过
- [ ] `pnpm tauri dev` 启动后，点击 Skills 面板能看到 tag group 列表和 skill 列表

## 不包含

- 不修改前端 UI 组件
- 不添加新功能
