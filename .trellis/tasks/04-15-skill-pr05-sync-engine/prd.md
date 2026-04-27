# PR#5: Skill Sync 部署引擎

## 概述

实现 Skill 从中央仓库（`~/.neeko/skills/<name>/`）部署到各 Agent 工具目录（如 `~/.claude/skills/<name>/`）的同步引擎。支持 symlink 和 copy 两种模式，以及按标签组合批量 sync/unsync。部署记录写入 SQLite `skill_targets` 表。

## 依赖

- PR#1: 数据模型（ToolAdapter, SkillTargetRecord）
- PR#2: SkillStore SQLite（CRUD 操作）
- PR#4: 标签组合系统（TagGroup 关联 + 工具开关）

## 参考项目

- `skills-manager/src-tauri/src/core/sync_engine.rs` — Sync 引擎核心（symlink/copy/remove，含完整测试）
- `skills-manager/src-tauri/src/commands/sync.rs` — sync/unsync 命令
- `skills-manager/src-tauri/src/commands/scenarios.rs` — 场景切换时的批量 sync/unsync

## 需求

### 1. SyncEngine 模块（`src-tauri/src/skill/sync_engine.rs`）

#### SyncMode
```rust
pub enum SyncMode {
    Symlink,  // Unix: 符号链接; Windows: 自动回退为 Copy
    Copy,     // 递归复制（跳过 .git 和 symlink）
}
```

#### 核心函数（完全对齐 skills-manager）
- `sync_mode_for_tool(tool_key, configured_mode) -> SyncMode`
  - Cursor 默认 Copy，其他默认 Symlink
  - 可通过 SQLite settings 表的 `sync_mode` 配置覆盖
- `sync_skill(source, target, mode) -> Result<SyncMode>`
  - 创建父目录
  - 删除已存在的目标
  - 按 mode 创建 symlink 或递归 copy
  - Windows 上 symlink 自动回退为 copy
- `remove_target(target) -> Result<()>`
  - 删除 symlink / 目录 / 文件
- `copy_dir_recursive(src, dst) -> Result<()>`
  - 跳过 `.git` 目录

### 2. 标签组合级别的 Sync/Unsync

#### sync_tag_group_skills(store, tag_group_id)
1. 获取 tag_group 中的所有 Skill
2. 对每个 Skill，通过 `get_enabled_tools_for_tag_group_skill()` 获取工具开关
3. 对每个 enabled 的工具，执行 `sync_skill(source, target, mode)`
4. 记录 SkillTargetRecord 到 SQLite

#### unsync_tag_group_skills(store, tag_group_id)
1. 获取 tag_group 中的所有 Skill
2. 对每个 Skill 的所有 targets 执行 `remove_target()`
3. 删除 SQLite 中的 SkillTargetRecord

### 3. Tauri 命令

| 命令 | 参数 | 返回 | 说明 |
|------|------|------|------|
| `sync_skill_to_tool` | `skill_id, tool` | `()` | 单个 Skill 同步到工具 |
| `unsync_skill_from_tool` | `skill_id, tool` | `()` | 取消同步 |
| `sync_tag_group` | `tag_group_id: String` | `()` | 批量加载标签组 Skill |
| `unsync_tag_group` | `tag_group_id: String` | `()` | 批量卸载 |

### 4. 同步触发时机

- 手动：用户在 UI 中点击同步按钮
- 标签组变更：向标签组添加/移除 Skill 时（如果该标签组被当前项目绑定）
- 项目切换标签组时：unsync 旧组 → sync 新组（PR#7 实现）

## 验收标准

- [ ] Symlink 模式：Unix 上创建符号链接
- [ ] Copy 模式：递归复制，跳过 `.git`
- [ ] Windows 上 Symlink 自动回退为 Copy
- [ ] 目标已存在时先清理再重建
- [ ] 标签组批量 sync/unsync 正确
- [ ] SkillTargetRecord 正确写入/清理 SQLite
- [ ] 工具开关（tool toggle）控制生效
- [ ] `cargo check` 通过
- [ ] 有完整的单元测试（参考 skills-manager sync_engine 的 tests 模块）

## 不包含

- 不包含 Project 级别的标签组绑定和自动触发（PR#7）
- 不包含前端 UI（PR#6）
