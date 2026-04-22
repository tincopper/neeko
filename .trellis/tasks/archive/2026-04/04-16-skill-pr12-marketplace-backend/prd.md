# PR#12: Marketplace backend — Skills.sh API, git fetcher, cache

## 概述

实现 Skill 市场的完整后端支持：
1. **Skills.sh API** — Leaderboard 获取 + Search 搜索
2. **Git Fetcher** — 通过 Git URL 克隆仓库获取 Skill
3. **Marketplace Install** — 从 Skills.sh 安装 Skill 到 central repo
4. **Cache 机制** — SQLite 缓存 leaderboard 结果，避免频繁请求

## 依赖

- PR#8: 命令注册（确保新命令也能注册）
- PR#3: installer.rs（复用安装逻辑）

## 参考项目

- `skills-manager/src-tauri/src/core/skillssh_api.rs` — Skills.sh HTML 解析 + Search API
- `skills-manager/src-tauri/src/core/git_fetcher.rs` — Git 仓库克隆
- `skills-manager/src-tauri/src/commands/browse.rs` — Browse 命令 + 缓存
- `skills-manager/src-tauri/src/commands/skills.rs` — `install_from_skillssh()`

## 需求

### 1. 新增 Rust 模块

#### `src-tauri/src/skill/skillssh_api.rs`

从 skills-manager 移植，适配 neeko：

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SkillsShSkill {
    pub id: String,        // "{source}/{skill_id}"
    pub skill_id: String,  // e.g. "vite"
    pub name: String,      // display name
    pub source: String,    // e.g. "antfu/skills"
    pub installs: u64,     // download count
}

pub enum LeaderboardType { AllTime, Trending, Hot }

pub fn build_http_client(proxy_url: Option<&str>, timeout_secs: u64) -> reqwest::blocking::Client;
pub fn fetch_leaderboard(board: LeaderboardType, proxy_url: Option<&str>) -> Result<Vec<SkillsShSkill>>;
pub fn search_skills(query: &str, limit: usize, proxy_url: Option<&str>) -> Result<Vec<SkillsShSkill>>;
```

HTML 解析策略（与 skills-manager 一致）：
1. 优先解析 `__NEXT_DATA__` JSON
2. 回退到 Regex 解析 RSC payload

#### `src-tauri/src/skill/git_fetcher.rs`

从 skills-manager 移植核心功能：

```rust
pub struct ParsedGitSource {
    pub original_url: String,
    pub clone_url: String,
    pub branch: Option<String>,
    pub subpath: Option<String>,
}

pub fn parse_git_source(url: &str) -> ParsedGitSource;
pub fn validate_git_url(url: &str) -> Result<()>;
pub fn clone_repo_ref(url: &str, branch: Option<&str>, cancel: Option<&AtomicBool>, proxy: Option<&str>) -> Result<PathBuf>;
pub fn get_head_revision(repo_path: &Path) -> Result<String>;
pub fn cleanup_temp(path: &Path);
```

实现方式：使用 `git` CLI（而非 git2-rs），因为需要支持 shallow clone 和认证。

### 2. 数据库迁移 v3

新增 `skillssh_cache` 表：

```sql
CREATE TABLE IF NOT EXISTS skillssh_cache (
    cache_key TEXT PRIMARY KEY,
    data TEXT NOT NULL,
    fetched_at INTEGER
);
```

### 3. SkillStore 新增方法

```rust
// Cache
pub fn get_cache(&self, key: &str, ttl_secs: i64) -> Result<Option<String>>;
pub fn set_cache(&self, key: &str, data: &str) -> Result<()>;

// Proxy
pub fn proxy_url(&self) -> Option<String>;
```

### 4. 新增 Tauri 命令

```rust
// Browse / Search
#[tauri::command]
pub async fn fetch_leaderboard(board: String, store: State<'_, Arc<SkillStore>>) -> Result<Vec<SkillsShSkill>, String>;

#[tauri::command]
pub async fn search_skillssh(query: String, limit: Option<usize>, store: State<'_, Arc<SkillStore>>) -> Result<Vec<SkillsShSkill>, String>;

// Install from marketplace
#[tauri::command]
pub async fn install_from_skillssh(
    source: String,
    skill_id: String,
    store: State<'_, Arc<SkillStore>>,
    app_handle: tauri::AppHandle,
) -> Result<(), String>;
```

`install_from_skillssh` 流程：
1. 构造 GitHub URL: `https://github.com/{source}.git`
2. Emit `install-progress { phase: "cloning" }`
3. `git_fetcher::clone_repo_ref()` → shallow clone 到临时目录
4. Emit `install-progress { phase: "installing" }`
5. 找到 skill 子目录 → `installer::install_skill_dir_to_destination()`
6. 写入 skills 表（source_type: "skillssh"）
7. Emit `install-progress { phase: "done" }`
8. 清理临时目录

### 5. 新增 Cargo 依赖

```toml
reqwest = { version = "0.12", features = ["blocking", "json"] }
regex = "1"
urlencoding = "2"
```

### 6. TypeScript 类型扩展

```typescript
// types.ts
export interface SkillsShSkill {
  id: string;
  skill_id: string;
  name: string;
  source: string;
  installs: number;
}

export interface InstallProgress {
  skill_id: string;
  phase: "cloning" | "installing" | "done" | "error";
  error?: string;
}
```

### 7. 注册新命令

在 `lib.rs` 的 `invoke_handler` 中注册：
- `skill::commands::fetch_leaderboard`
- `skill::commands::search_skillssh`
- `skill::commands::install_from_skillssh`

## 验收标准

- [ ] `fetch_leaderboard("alltime")` 返回 Skills.sh 排行榜数据
- [ ] `search_skillssh("react")` 返回搜索结果
- [ ] Leaderboard 结果被缓存（5 分钟 TTL）
- [ ] `install_from_skillssh("antfu/skills", "vite")` 能安装到 ~/.neeko/skills/
- [ ] 安装过程 emit `install-progress` 事件
- [ ] `skillssh_cache` 表正确创建（迁移 v3）
- [ ] `cargo check` 通过
- [ ] `cargo test --lib skill` 通过（含 HTML 解析测试）
- [ ] `npx tsc --noEmit` 通过

## 不包含

- 前端市场 UI（PR#13）
- Git URL 安装预览（可未来扩展）
- SkillsMP API（暂不集成）
- 安装取消（可未来扩展）
