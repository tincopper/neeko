# PR#2: SkillStore SQLite 持久化与 CRUD Tauri 命令

## 概述

实现 Skill 数据的 SQLite 持久化存储和核心 CRUD 操作，注册为 Tauri IPC 命令供前端调用。完全参照 skills-manager 的 `SkillStore` 实现，使用 `rusqlite` + WAL 模式。

## 依赖

- PR#1: Skill 数据模型与类型定义（含 rusqlite 依赖）

## 参考项目

- `skills-manager/src-tauri/src/core/skill_store.rs` — 完整的 SQLite SkillStore 实现（1011 行）
- `skills-manager/src-tauri/src/core/migrations.rs` — 数据库迁移链
- `skills-manager/src-tauri/src/commands/skills.rs` — Tauri 命令定义

## 需求

### 1. SkillStore 模块（`src-tauri/src/skill/skill_store.rs`）

```rust
pub struct SkillStore {
    conn: Mutex<Connection>,  // rusqlite::Connection
}
```

**直接参照 skills-manager 的 SkillStore**，实现以下核心方法：

#### Skills CRUD
- `insert_skill(skill: &SkillRecord) -> Result<()>`
- `get_all_skills() -> Result<Vec<SkillRecord>>`
- `get_skill_by_id(id: &str) -> Result<Option<SkillRecord>>`
- `get_skill_by_central_path(central_path: &str) -> Result<Option<SkillRecord>>`
- `update_skill_after_install(...)` — 更新安装后的元数据
- `update_skill_check_state(...)` — 更新检查状态
- `delete_skill(id: &str) -> Result<()>`

#### Targets
- `insert_target(target: &SkillTargetRecord) -> Result<()>`
- `get_targets_for_skill(skill_id: &str) -> Result<Vec<SkillTargetRecord>>`
- `get_all_targets() -> Result<Vec<SkillTargetRecord>>`
- `delete_target(skill_id: &str, tool: &str) -> Result<()>`

#### Skill Tags
- `get_all_tags() -> Result<Vec<String>>`
- `set_tags_for_skill(skill_id: &str, tags: &[String]) -> Result<()>`
- `get_tags_map() -> Result<HashMap<String, Vec<String>>>`

### 2. 数据库迁移（`src-tauri/src/skill/migrations.rs`）

参照 skills-manager 的 migrations.rs：
- `LATEST_VERSION = 1`
- 初始 schema：`skills`, `skill_targets`, `skill_tags`, `tag_groups`, `tag_group_skills`, `tag_group_skill_tools`, `settings` 表
- `run_migrations(conn: &Connection) -> Result<()>`
- WAL 模式 + 外键约束

### 3. Tauri 命令

#### Skill CRUD 命令
| 命令 | 参数 | 返回 | 说明 |
|------|------|------|------|
| `get_managed_skills` | — | `Vec<ManagedSkillDto>` | 获取所有已管理 Skill（含 tags）|
| `get_skill_document` | `skill_id: String` | `SkillDocumentDto` | 读取 SKILL.md 内容 |
| `delete_managed_skill` | `skill_id: String` | `()` | 删除 Skill（含级联清理）|

#### Tool 状态命令
| 命令 | 参数 | 返回 | 说明 |
|------|------|------|------|
| `get_tool_status` | — | `Vec<ToolStatusDto>` | 获取所有工具安装状态 |

### 4. AppStateWrapper 扩展

```rust
pub struct AppStateWrapper {
    // ... 现有字段 ...
    pub skill_store: Arc<SkillStore>,  // 新增，Arc 包裹以支持跨线程
}
```

### 5. 数据库路径

- 数据库文件：`~/.neeko/skills.db`
- 通过 `StorageManager::config_dir()` 获取目录
- 在 `AppStateWrapper::new()` 中初始化

## 验收标准

- [ ] SkillStore 基于 rusqlite 完整实现
- [ ] 数据库迁移正确（v1 初始 schema）
- [ ] WAL 模式和外键约束生效
- [ ] Skills CRUD 操作正确
- [ ] Targets 操作正确
- [ ] Skill Tags 操作正确
- [ ] 删除 Skill 时级联清理 targets 和 tag_group 引用
- [ ] 所有 Tauri 命令注册且可调用
- [ ] AppStateWrapper 正确集成 SkillStore
- [ ] `cargo check` 通过
- [ ] 核心逻辑有单元测试（CRUD/级联删除/迁移）

## 不包含

- 不包含 TagGroup CRUD（PR#4）
- 不包含 Skill 安装逻辑（PR#3）
- 不包含 Sync 部署逻辑（PR#5）
- 不包含前端 UI（PR#6）
