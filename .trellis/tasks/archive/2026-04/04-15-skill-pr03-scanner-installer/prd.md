# PR#3: Skill 扫描发现与安装引擎

## 概述

实现 Skill 的安装、扫描发现和更新检测引擎。用户可以从本地目录、Git 仓库或 ZIP 文件安装 Skill，系统也能自动扫描已安装的 Agent 工具目录发现未管理的 Skill。

## 依赖

- PR#1: 数据模型
- PR#2: SkillStore SQLite 持久化

## 参考项目

- `skills-manager/src-tauri/src/core/installer.rs` — 安装引擎（本地/ZIP/Zip Slip 防护）
- `skills-manager/src-tauri/src/core/scanner.rs` — 扫描逻辑
- `skills-manager/src-tauri/src/core/content_hash.rs` — SHA256 目录 hash
- `skills-manager/src-tauri/src/core/git_fetcher.rs` — Git clone/更新

## 需求

### 1. Installer 模块（`src-tauri/src/skill/installer.rs`）

#### 本地目录安装 (`install_from_local`)
1. 接收源路径（目录或 ZIP 文件）
2. 若为 ZIP：使用 `safe_extract()` 解压到临时目录（含 Zip Slip 防护）
3. 在源目录中搜索 `SKILL.md` / `skill.md` / `CLAUDE.md`（最多 4 层深度）
4. 解析 SKILL.md 获取 name/description
5. `sanitize_skill_name()` 标准化名称
6. 若中央仓库 `~/.neeko/skills/<name>/` 已存在，追加 `-2`, `-3` 后缀
7. 递归复制到中央仓库（跳过 `.git` 目录和符号链接）
8. 计算 `content_hash` (SHA256)
9. 写入 SkillStore（SQLite）

#### Git 仓库安装 (`install_from_git`)
1. `preview_git_install` — Clone 到临时目录，列出可用 Skill 目录
2. `confirm_git_install` — 将选中的 Skill 复制到中央仓库
3. 记录 `source_revision` (commit hash) 和 `source_ref`

### 2. Scanner 模块（`src-tauri/src/skill/scanner.rs`）

- 遍历所有已安装 ToolAdapter 的 `skills_dir()` 和 `all_scan_dirs()`
- 发现包含 SKILL.md 且未被管理的目录
- 计算 fingerprint (content_hash) 用于去重
- 返回 DiscoveredSkill 列表
- 结果存入 SQLite `discovered_skills` 表

### 3. ContentHash 模块（`src-tauri/src/skill/content_hash.rs`）

- `hash_directory(path: &Path) -> Result<String>` — 递归计算目录内容 SHA256
- 跳过 `.git` 目录

### 4. 新增 Cargo.toml 依赖

- `walkdir` — 递归目录遍历
- `zip` — ZIP 文件解压
- `sha2` — SHA256 计算

### 5. Tauri 命令

| 命令 | 参数 | 返回 | 说明 |
|------|------|------|------|
| `install_local_skill` | `source_path: String` | `SkillRecord` | 本地安装 |
| `install_git_skill` | `clone_url, branch?, subpath?` | `SkillRecord` | Git 安装 |
| `preview_git_install` | `clone_url, branch?, subpath?` | `GitSkillPreview` | 预览 |
| `confirm_git_install` | `preview_id, selected_dir` | `SkillRecord` | 确认 |
| `cancel_git_preview` | `preview_id` | `()` | 取消 |
| `scan_local_skills` | — | `Vec<DiscoveredSkill>` | 扫描 |
| `import_discovered_skill` | `discovered_id: String` | `SkillRecord` | 导入发现的 Skill |
| `check_skill_update` | `skill_id: String` | `UpdateStatus` | 检查更新 |
| `update_skill` | `skill_id: String` | `()` | 应用更新 |

## 验收标准

- [ ] 本地目录安装正确复制到中央仓库
- [ ] ZIP 安装含 Zip Slip 防护
- [ ] Git 安装支持 preview → confirm 两步流程
- [ ] 同名 Skill 自动添加后缀
- [ ] Scanner 能发现已安装 Agent 工具目录中的 Skill
- [ ] content_hash 计算一致性
- [ ] 复制时跳过 `.git` 目录和符号链接
- [ ] 安装结果写入 SQLite
- [ ] 核心安装逻辑有单元测试

## 不包含

- 不包含 Sync 部署到工具目录（PR#5）
- 不包含前端安装 UI（PR#6）
- 不包含 Skills.sh 市场功能（可未来扩展）
