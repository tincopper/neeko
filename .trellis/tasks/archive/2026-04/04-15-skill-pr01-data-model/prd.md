# PR#1: Skill 数据模型与类型定义

## 概述

定义 Skill 管理系统的核心数据结构，同时覆盖 Rust 后端和 TypeScript 前端。这是整个 Skill 管理功能的基础层，后续所有 PR 都依赖此数据模型。

## 参考项目

- 原始项目：`E:\workspaces\rust_space\skills-manager`
- 参考文件：
  - `src-tauri/src/core/skill_store.rs` — SkillRecord, ScenarioRecord, SkillTargetRecord
  - `src-tauri/src/core/tool_adapters.rs` — ToolAdapter 结构体
  - `src-tauri/src/core/skill_metadata.rs` — SKILL.md 解析
- 本项目设计文档：`docs/skill-management-design.md`

## 需求

### Rust 后端类型（新增 `src-tauri/src/skill/` 模块）

1. **SkillRecord** — 已管理的 Skill 记录（对齐 skills-manager 的 SkillRecord）
   - id: TEXT PK (UUID)
   - name: TEXT (sanitized, 小写+连字符，≤100字符)
   - description: TEXT?
   - source_type: TEXT ("local" | "git")
   - source_ref: TEXT? (原始来源路径或 URL)
   - source_ref_resolved: TEXT?
   - source_subpath: TEXT?
   - source_branch: TEXT?
   - source_revision: TEXT? (Git commit hash)
   - remote_revision: TEXT? (远程 HEAD)
   - central_path: TEXT UNIQUE (`~/.neeko/skills/<name>/`)
   - content_hash: TEXT? (SHA256)
   - enabled: BOOL
   - status: TEXT ("ok" 等)
   - update_status: TEXT ("up_to_date" | "update_available" | "unknown")
   - last_checked_at: i64?
   - last_check_error: TEXT?
   - created_at / updated_at: i64

2. **ToolAdapter** — AI Agent 工具适配器（参考 skills-manager 的 15 种内置工具）
   - key: String (如 "claude_code", "cursor")
   - display_name: String
   - relative_skills_dir: String (如 ".claude/skills")
   - relative_detect_dir: String (如 ".claude")
   - override_skills_dir: Option<String>
   - is_custom: bool
   - is_installed() 检测逻辑
   - skills_dir() 路径解析（支持 `~/.xxx` 和 `~/.config/xxx` 双候选）

3. **SkillTargetRecord** — Skill 部署到工具的记录
   - id, skill_id, tool, target_path, mode ("symlink"|"copy"), status, synced_at

4. **SkillMetadata** — SKILL.md 文件解析结果
   - name, description (从 YAML frontmatter 解析)
   - sanitize_skill_name() 函数
   - is_valid_skill_dir() 检测

5. **TagGroup（新增概念）** — 标签组合（对应 skills-manager 的 Scenario）
   - id: TEXT PK (UUID)
   - name: TEXT UNIQUE (如 "设计师", "后端架构师", "全栈开发")
   - description: TEXT?
   - icon: TEXT?
   - sort_order: i32
   - created_at / updated_at: i64

6. **关联表**
   - `tag_group_skills(tag_group_id, skill_id, sort_order)` — TagGroup 中的 Skill 及排序
   - `tag_group_skill_tools(tag_group_id, skill_id, tool, enabled)` — 细粒度工具开关
   - `skill_tags(skill_id, tag)` — Skill 个体标签（多对多）

### TypeScript 前端类型（`src/types.ts` 扩展）

```typescript
// Skill 管理相关类型
interface SkillRecord {
  id: string;
  name: string;
  description: string | null;
  source_type: "local" | "git";
  source_ref: string | null;
  central_path: string;
  content_hash: string | null;
  enabled: boolean;
  status: string;
  update_status: "up_to_date" | "update_available" | "unknown";
  tags: string[];
  created_at: number;
  updated_at: number;
}

interface ToolInfo {
  key: string;
  display_name: string;
  installed: boolean;
  has_override: boolean;
  is_custom: boolean;
}

interface TagGroup {
  id: string;
  name: string;
  description: string | null;
  icon: string | null;
  sort_order: number;
  skill_count: number;
}

interface SkillTargetRecord {
  id: string;
  skill_id: string;
  tool: string;
  target_path: string;
  mode: "symlink" | "copy";
  status: string;
  synced_at: number | null;
}

interface SkillToolToggle {
  tool: string;
  display_name: string;
  enabled: boolean;
  installed: boolean;
}
```

### 中央仓库目录

- 路径：`~/.neeko/skills/` — 所有已安装 Skill 的唯一事实来源
- 每个 Skill 是一个独立目录，包含 `SKILL.md` 入口文件

## 验收标准

- [ ] Rust 后端所有核心结构体定义完成，含 Serialize/Deserialize derive
- [ ] TypeScript 前端类型定义完成（`src/types.ts`）
- [ ] `sanitize_skill_name()` 函数实现并有单元测试
- [ ] `is_valid_skill_dir()` 函数实现并有单元测试
- [ ] SKILL.md YAML frontmatter 解析实现并有单元测试
- [ ] ToolAdapter 内置列表定义（至少 claude_code, cursor, codex, opencode, gemini_cli）
- [ ] ToolAdapter 的 `is_installed()` 和 `skills_dir()` 逻辑实现
- [ ] `cargo check` 和 `npx tsc --noEmit` 通过
- [ ] 中央仓库目录 `~/.neeko/skills/` 自动创建逻辑

## 技术决策

- **持久化方式**：使用 SQLite（`rusqlite`），与 skills-manager 保持一致。数据库文件位于 `~/.neeko/skills-manager.db`。Neeko 现有的 sessions.json/config.json 仅保存一个指向 SQLite 数据库的索引路径，skill 相关数据全部由 SQLite 管理。需要在 `Cargo.toml` 中添加 `rusqlite` 依赖（bundled 特性）
- **ToolAdapter 与现有 AgentConfig 的关系**：ToolAdapter 是 Skill 部署目标（如 ~/.claude/skills/），AgentConfig 是终端启动命令。同一个 Agent（如 claude-code）在两个系统中分别有对应实体
- **TagGroup 对应 skills-manager 的 Scenario**：概念映射但定制化，不需要全局 active_scenario 切换，改为 Project 级别绑定（PR#7）

## 不包含

- 不包含 SkillStore 持久化 CRUD 实现（PR#2）
- 不包含扫描/安装逻辑（PR#3）
- 不包含前端 UI 组件（PR#6）
