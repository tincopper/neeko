# 后端测试

> Tauri 后端的 Rust 单元测试模式。

---

## 环境搭建

### 添加开发依赖

在 `src-tauri/Cargo.toml` 中：

```toml
[dev-dependencies]
tempfile = "3"
```

### 运行测试

```bash
cd src-tauri
cargo test                    # 所有测试
cargo test agent              # 匹配 "agent" 的测试
cargo test -- --nocapture     # 显示 println 输出
cargo test -- --test-threads=1  # 顺序执行（文件系统测试需要时）
```

---

## 测试纯逻辑（P0）

### `agent.rs` —— AgentManager

零外部依赖，纯内存逻辑：

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn new_manager_has_default_agents() {
        let manager = AgentManager::new();
        let agents = manager.get_agents();
        assert!(!agents.is_empty());
        assert!(agents.iter().any(|a| a.id == "claude-code"));
    }

    #[test]
    fn add_custom_agent() {
        let mut manager = AgentManager::new();
        let initial = manager.get_agents().len();

        manager.add_agent(AgentConfig {
            id: "test-agent".into(),
            name: "Test".into(),
            command: "test".into(),
            args: vec![],
            env: HashMap::new(),
            icon: None,
            enabled: true,
        });

        assert_eq!(manager.get_agents().len(), initial + 1);
        assert!(manager.get_agent("test-agent").is_some());
    }

    #[test]
    fn remove_agent() {
        let mut manager = AgentManager::new();
        manager.add_agent(AgentConfig {
            id: "temp".into(),
            name: "Temp".into(),
            command: "temp".into(),
            args: vec![],
            env: HashMap::new(),
            icon: None,
            enabled: true,
        });

        manager.remove_agent("temp");
        assert!(manager.get_agent("temp").is_none());
    }

    #[test]
    fn get_nonexistent_agent_returns_none() {
        let manager = AgentManager::new();
        assert!(manager.get_agent("nonexistent").is_none());
    }
}
```

### `state.rs` —— Serde 往返测试

验证序列化/反序列化的正确性，特别是枚举：

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use serde_json;

    #[test]
    fn file_status_serde_roundtrip() {
        let statuses = vec![
            FileStatus::Modified,
            FileStatus::Added,
            FileStatus::Deleted,
            FileStatus::Renamed,
            FileStatus::Untracked,
        ];
        for status in statuses {
            let json = serde_json::to_string(&status).unwrap();
            let back: FileStatus = serde_json::from_str(&json).unwrap();
            assert_eq!(format!("{:?}", status), format!("{:?}", back));
        }
    }

    #[test]
    fn auth_method_password_serialization() {
        let auth = AuthMethod::Password("secret".into());
        let json = serde_json::to_string(&auth).unwrap();
        assert_eq!(json, r#"{"Password":"secret"}"#);

        let back: AuthMethod = serde_json::from_str(&json).unwrap();
        matches!(back, AuthMethod::Password(s) if s == "secret");
    }

    #[test]
    fn view_mode_terminal_serializes_as_string() {
        let mode = ViewMode::Terminal;
        let json = serde_json::to_string(&mode).unwrap();
        assert_eq!(json, r#""Terminal""#);
    }

    #[test]
    fn view_mode_diff_serializes_as_object() {
        let mode = ViewMode::Diff { file_path: "src/main.rs".into() };
        let json = serde_json::to_string(&mode).unwrap();
        assert!(json.contains("Diff"));
        assert!(json.contains("src/main.rs"));
    }

    #[test]
    fn session_store_defaults_for_missing_fields() {
        // 模拟加载缺少新字段的旧 sessions.json
        let json = r#"{
            "projects": [],
            "active_project_id": null,
            "last_updated": "2024-01-01T00:00:00+00:00"
        }"#;
        let store: SessionStore = serde_json::from_str(json).unwrap();
        assert!(store.wsl_entries.is_empty());      // #[serde(default)]
        assert!(store.remote_entries.is_empty());    // #[serde(default)]
        assert!(store.sidebar_width.is_none());      // #[serde(default)]
    }
}
```

---

## 使用文件系统的测试（P1）

### `project.rs` —— ProjectManager

需要真实目录。使用 `tempfile::TempDir`：

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn add_project_from_valid_path() {
        let tmp = TempDir::new().unwrap();
        let mut pm = ProjectManager::new();

        let project = pm.add_project(tmp.path().to_path_buf(), None, None).unwrap();

        assert_eq!(pm.list_projects().len(), 1);
        assert_eq!(project.path, tmp.path().to_string_lossy());
    }

    #[test]
    fn add_project_nonexistent_path_fails() {
        let mut pm = ProjectManager::new();
        let result = pm.add_project("/nonexistent/path/xyz".into(), None, None);
        assert!(result.is_err());
    }

    #[test]
    fn remove_project_by_id() {
        let tmp = TempDir::new().unwrap();
        let mut pm = ProjectManager::new();
        let project = pm.add_project(tmp.path().to_path_buf(), None, None).unwrap();

        pm.remove_project(&project.id);
        assert!(pm.list_projects().is_empty());
    }

    #[test]
    fn rename_project() {
        let tmp = TempDir::new().unwrap();
        let mut pm = ProjectManager::new();
        let project = pm.add_project(tmp.path().to_path_buf(), None, None).unwrap();

        pm.rename_project(&project.id, "new-name").unwrap();
        assert_eq!(pm.get_project(&project.id).unwrap().name, "new-name");
    }
}
```

### `storage.rs` —— StorageManager

使用临时目录测试持久化：

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn test_storage() -> (TempDir, StorageManager) {
        let tmp = TempDir::new().unwrap();
        let manager = StorageManager { config_dir: tmp.path().to_path_buf() };
        (tmp, manager)
    }

    #[test]
    fn save_and_load_session_roundtrip() {
        let (_tmp, manager) = test_storage();
        let session = SessionStore { /* ... */ };

        manager.save_session(&session).unwrap();
        let loaded = manager.load_session().unwrap();

        assert!(loaded.projects.is_empty());
    }

    #[test]
    fn save_and_load_config_roundtrip() {
        let (_tmp, manager) = test_storage();
        let config = serde_json::json!({ "fontSize": 16, "diffMode": "split" });

        manager.save_config(&config).unwrap();
        let loaded = manager.load_config().unwrap();

        assert_eq!(loaded["fontSize"], 16);
        assert_eq!(loaded["diffMode"], "split");
    }
}
```

---

## 测试 Git 操作（P2）

### `git.rs` —— 使用真实临时仓库

**不要 mock git2。** 创建真实的临时 git 仓库——操作快速且测试更准确。

### 辅助函数：创建测试仓库

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use git2::{Repository, Signature};
    use tempfile::TempDir;
    use std::fs;

    /// 创建带有初始化 git 仓库和一次提交的临时目录。
    fn create_test_repo() -> (TempDir, Repository) {
        let tmp = TempDir::new().unwrap();
        let repo = Repository::init(tmp.path()).unwrap();

        // 创建初始提交
        let sig = Signature::now("Test", "test@test.com").unwrap();
        fs::write(tmp.path().join("README.md"), "# Test").unwrap();

        let mut index = repo.index().unwrap();
        index.add_path(std::path::Path::new("README.md")).unwrap();
        index.write().unwrap();
        let tree_id = index.write_tree().unwrap();
        let tree = repo.find_tree(tree_id).unwrap();

        repo.commit(Some("HEAD"), &sig, &sig, "Initial commit", &tree, &[]).unwrap();

        (tmp, repo)
    }

    #[test]
    fn get_git_info_on_clean_repo() {
        let (tmp, _repo) = create_test_repo();
        let info = get_git_info(tmp.path()).unwrap();

        assert!(info.is_clean);
        assert!(info.changed_files.is_empty());
        assert!(!info.current_branch.is_empty());
    }

    #[test]
    fn get_git_info_detects_modified_file() {
        let (tmp, _repo) = create_test_repo();
        fs::write(tmp.path().join("README.md"), "# Modified").unwrap();

        let info = get_git_info(tmp.path()).unwrap();
        assert!(!info.is_clean);
        assert!(info.changed_files.iter().any(|f| f.path == "README.md"));
    }

    #[test]
    fn create_and_list_branches() {
        let (tmp, _repo) = create_test_repo();
        create_branch(tmp.path(), "feature-1", None).unwrap();

        let info = get_git_info(tmp.path()).unwrap();
        assert!(info.branches.contains(&"feature-1".to_string()));
    }

    #[test]
    fn checkout_branch_switches_head() {
        let (tmp, _repo) = create_test_repo();
        create_branch(tmp.path(), "develop", None).unwrap();
        checkout_branch(tmp.path(), "develop").unwrap();

        let info = get_git_info(tmp.path()).unwrap();
        assert_eq!(info.current_branch, "develop");
    }

    #[test]
    fn is_git_repo_returns_true_for_repo() {
        let (tmp, _repo) = create_test_repo();
        assert!(is_git_repo(tmp.path()));
    }

    #[test]
    fn is_git_repo_returns_false_for_plain_dir() {
        let tmp = TempDir::new().unwrap();
        assert!(!is_git_repo(tmp.path()));
    }
}
```

### 测试 diff 解析（纯函数）

```rust
#[test]
fn parse_unified_diff_single_hunk() {
    let diff = r#"diff --git a/file.txt b/file.txt
--- a/file.txt
+++ b/file.txt
@@ -1,3 +1,4 @@
 line1
+added line
 line2
 line3
"#;
    let result = parse_unified_diff(diff);
    assert_eq!(result.hunks.len(), 1);
    assert_eq!(result.hunks[0].new_lines, 4);
}

#[test]
fn parse_unified_diff_empty_input() {
    let result = parse_unified_diff("");
    assert!(result.hunks.is_empty());
}
```

---

## 各模块测试策略

| 模块 | 策略 | 依赖 |
|------|------|------|
| `agent.rs` | 直接单元测试 | 无 |
| `state.rs` | Serde 往返测试 | 无 |
| `project.rs` | 使用 `tempfile` 的单元测试 | 文件系统 |
| `git.rs` | 使用 `tempfile` + `git2` 的真实临时仓库 | 文件系统、git2 |
| `storage.rs` | 使用临时目录的单元测试 | 文件系统 |
| `terminal.rs` | **跳过** —— 必要时提取纯函数 | PTY、线程、Tauri 事件 |
| `remote.rs` | **跳过** —— 需要真实 SSH 服务器 | SSH、线程、Tauri 事件 |
| `watcher.rs` | 可选的集成测试（临时目录 + 文件写入） | notify、Tauri 事件 |
| `lib.rs` | 测试内部 Manager，不测试命令包装 | Tauri State |

---

## 关键约定

### 测试模块位置

始终在源文件底部：

```rust
// ... 生产代码在上方 ...

#[cfg(test)]
mod tests {
    use super::*;
    // ... 测试 ...
}
```

### 测试命名

```rust
#[test]
fn <函数或方法>_<场景>_<期望行为>() { ... }

// 示例：
fn add_project_valid_path_returns_project() { ... }
fn add_project_nonexistent_path_fails() { ... }
fn get_agent_nonexistent_returns_none() { ... }
```

### 断言

使用具体的断言：

```rust
// 推荐：具体断言
assert_eq!(result.len(), 3);
assert!(result.is_err());
assert!(list.contains(&"item".to_string()));

// 避免：模糊断言
assert!(result.len() > 0);  // 使用 assert!(!result.is_empty())
```

---

## 常见错误

### 1. 不使用 `tempfile` —— 硬编码路径

```rust
// 错误 —— 在其他机器上失败，留下垃圾文件
let path = "/tmp/test-project";
fs::create_dir_all(path).unwrap();

// 正确 —— 自动清理，每个测试唯一
let tmp = TempDir::new().unwrap();
```

### 2. 测试间存在依赖

每个测试必须独立。不要依赖测试执行顺序或共享的可变状态。

### 3. 直接测试 Tauri 命令包装

`lib.rs` 中的命令函数需要 `State<AppStateWrapper>`，而这需要 Tauri 运行时。改为测试内部 Manager 方法：

```rust
// 错误 —— 需要 Tauri 运行时
fn test_add_project_command() {
    add_project("path".into(), None, None, state, app_handle);
}

// 正确 —— 直接测试 Manager
fn test_add_project() {
    let mut pm = ProjectManager::new();
    pm.add_project(path, None, None).unwrap();
}
```

### 4. mock git2

```rust
// 错误 —— 复杂的 mock 设置，不能测试真实行为
let mock_repo = MockRepository::new();

// 正确 —— 真实临时仓库，快速且准确
let (tmp, repo) = create_test_repo();
```
