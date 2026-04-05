# 后端单元测试计划

## 目标

为 Neeko 的 Rust/Tauri 后端建立单元测试体系。当前项目零测试覆盖，需按优先级逐步为 5 个可测试模块添加测试。

---

## 现状分析

| 项目 | 状态 |
|------|------|
| 现有测试数量 | **0** |
| `#[cfg(test)]` 模块 | **无** |
| `tempfile` 依赖 | **未添加** |
| 可测模块 | agent.rs, state.rs, project.rs, git.rs (纯函数), storage.rs |
| 不测模块 | terminal.rs (PTY), remote.rs (SSH), watcher.rs (notify事件), git.rs (仓库操作) |

---

## 测试计划（按优先级分阶段）

### 阶段 1：P0 — 纯逻辑 & 序列化（零外部依赖）

#### 1.1 `agent.rs` — AgentManager

| 测试用例 | 验证内容 |
|----------|---------|
| `new_manager_has_default_agents` | `AgentManager::new()` 创建后包含 7 个预设 Agent |
| `default_agents_include_claude_code` | 预设 Agent 中包含 `claude-code` |
| `get_agents_returns_all` | `get_agents()` 返回完整列表 |
| `get_agent_by_id_found` | `get_agent("claude-code")` 返回 Some |
| `get_agent_nonexistent_returns_none` | `get_agent("nonexistent")` 返回 None |
| `add_custom_agent` | 添加自定义 Agent 后列表长度 +1，可通过 id 查询 |
| `remove_agent` | 删除 Agent 后通过 id 查询返回 None |
| `remove_nonexistent_agent_is_noop` | 删除不存在的 id 不报错，列表不变 |

**依赖**：无
**预计测试数**：8

#### 1.2 `state.rs` — Serde 往返测试

| 测试用例 | 验证内容 |
|----------|---------|
| `file_status_serde_roundtrip` | 所有 FileStatus 枚举变体序列化/反序列化一致 |
| `terminal_status_serde_roundtrip` | Idle/Running/Failed 往返 |
| `view_mode_terminal_serializes_as_string` | `ViewMode::Terminal` → `"Terminal"` |
| `view_mode_diff_serializes_as_object` | `ViewMode::Diff { file_path }` 含 path |
| `auth_method_password_serialization` | `AuthMethod::Password("secret")` 序列化格式正确 |
| `auth_method_keyfile_serialization` | `AuthMethod::KeyFile` 序列化格式正确 |
| `auth_method_keyfile_with_passphrase` | `AuthMethod::KeyFileWithPassphrase` 含两个字段 |
| `session_store_new_is_empty` | `SessionStore::new()` 所有字段为空/默认 |
| `session_store_defaults_for_missing_fields` | 缺少 `wsl_entries`/`remote_entries`/`sidebar_width` 的旧 JSON 能正确反序列化（`#[serde(default)]` 验证） |
| `project_session_default_collapsed_is_true` | 缺少 `collapsed` 字段时默认值为 `true` |
| `diff_line_variants_serde` | DiffLine::Context/Added/Removed 往返 |
| `diff_hunk_serde_roundtrip` | DiffHunk 完整往返 |

**依赖**：serde_json（已在 dependencies）
**预计测试数**：12

---

### 阶段 2：P1 — 需要文件系统（tempfile）

#### 2.1 `project.rs` — ProjectManager

| 测试用例 | 验证内容 |
|----------|---------|
| `add_project_valid_path` | 添加合法路径，返回 Project，列表长度 +1 |
| `add_project_name_from_dir` | Project.name 取自目录名 |
| `add_project_nonexistent_path_fails` | 路径不存在时返回 Err |
| `add_project_with_agent_and_ide` | agent_id 和 ide 参数正确存入 |
| `add_project_from_session` | 指定 id 恢复 Project |
| `remove_project_by_id` | 删除后列表为空 |
| `remove_nonexistent_project_is_noop` | 删除不存在 id 不报错 |
| `get_project_found` | 按 id 查询返回 Some |
| `get_project_not_found` | 不存在 id 返回 None |
| `list_projects_empty` | 初始列表为空 |
| `set_selected_agent` | 修改后 selected_agent 更新 |
| `set_selected_ide` | 修改后 selected_ide 更新 |
| `set_collapsed` | 修改后 collapsed 更新 |
| `set_view_terminal` | active_view 切换为 Terminal |
| `set_view_diff` | active_view 切换为 Diff |

**依赖**：tempfile（需添加到 dev-dependencies）
**预计测试数**：15

#### 2.2 `storage.rs` — StorageManager

| 测试用例 | 验证内容 |
|----------|---------|
| `save_and_load_session_roundtrip` | 保存后加载，projects 一致 |
| `load_session_no_file_returns_default` | 无文件时返回 SessionStore::new() |
| `save_and_load_config_roundtrip` | 保存 JSON config 后加载一致 |
| `load_config_no_file_returns_empty_object` | 无文件时返回 `{}` |
| `save_session_updates_last_updated` | 保存后 last_updated 非空 |
| `create_session_from_projects` | 转换 Project → ProjectSession 正确 |

**依赖**：tempfile（StorageManager 需构造函数接受自定义 config_dir，或通过字段修改）
**注意**：当前 `StorageManager::new()` 硬编码 `~/.neeko`，测试需要一种方式注入临时目录。建议添加 `StorageManager::with_config_dir(path)` 构造函数。
**预计测试数**：6

---

### 阶段 3：P2 — Git 纯函数解析

#### 3.1 `git.rs` — `parse_unified_diff` & `parse_hunk_header`

仅测试纯文本解析函数，**不创建真实 git 仓库**。所有需要 `Repository` 的函数（`get_git_info`、`create_branch`、`checkout_branch`、`get_file_diff` 等）不在单元测试范围内。

| 测试用例 | 验证内容 |
|----------|---------|
| `parse_unified_diff_single_hunk` | 单 hunk diff 解析正确 |
| `parse_unified_diff_multi_hunk` | 多 hunk diff 解析正确 |
| `parse_unified_diff_empty_input` | 空字符串返回空 hunks |
| `parse_unified_diff_add_only` | 仅有 `+` 行 |
| `parse_unified_diff_remove_only` | 仅有 `-` 行 |
| `parse_hunk_header_no_comma` | 省略行数时隐含为 1 |
| `parse_unified_diff_skips_file_headers` | `---`/`+++` 行不计入 diff lines |
| `parse_unified_diff_context_lines` | 空格开头的行识别为 Context |

**依赖**：无
**预计测试数**：8

---

## 准备工作

### 1. 添加 dev-dependencies

```toml
[dev-dependencies]
tempfile = "3"
```

### 2. 为 StorageManager 添加可测试构造函数

```rust
// storage.rs
impl StorageManager {
    /// 测试用：指定自定义 config 目录
    #[cfg(test)]
    pub fn with_config_dir(config_dir: PathBuf) -> Self {
        Self { config_dir }
    }
}
```

---

## 实施顺序

```
阶段 1（P0）  →  阶段 2（P1）  →  阶段 3（P2）
agent.rs        project.rs       git.rs 纯函数
state.rs        storage.rs
```

**总预计测试数**：~49 个

---

## 验收标准

- [ ] `cargo test` 全部通过
- [ ] `cargo clippy` 无警告
- [ ] 每个测试独立可运行（无顺序依赖）
- [ ] 测试使用 tempfile，不留磁盘垃圾
- [ ] 测试命名遵循 `<方法>_<场景>_<期望>` 格式
- [ ] 覆盖所有 P0/P1 模块的核心路径
