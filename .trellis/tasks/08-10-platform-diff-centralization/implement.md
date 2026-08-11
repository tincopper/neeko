# 平台差异集中化 · 实现路线图

> 本阶段不写业务代码。确认 design + prd 后，再 `task.py start` 进入实现。

## 实施批次

### 第一批：纯函数主题（零风险，先做）

| # | 主题 | 来源文件 | 目标接口 | 风险 |
|---|------|---------|---------|------|
| 1 | reveal | `file/commands.rs` | `build_reveal_command` | 低 |
| 2 | process_tree | `terminal/process_reaper.rs` | `snapshot_process_tree` | 低 |
| 3 | process_memory | `lsp/session/utils.rs` | `sample_process_memory_mb` | 低 |
| 4 | host_path | `core/exec_env.rs` | `resolve_host_path` | 低 |

### 第二批：逻辑差异大

| # | 主题 | 来源文件 | 目标接口 | 风险 |
|---|------|---------|---------|------|
| 5 | devtools | `browser/devtools.rs` + `browser/webview_ops.rs` | `DevToolsAdapter` trait + `open_devtools_detached` | 中 |
| 6 | git_credential | `common/git/credential.rs` | `platform_default()` | 中 |

## 每批 TDD 流程（红→绿→重构）

1. **🔴 红**：在 `platform/<theme>/` 建各平台实现文件 + 统一接口，先写迁移后的调用方测试（如 `build_reveal_command` 各平台返回正确命令），确认因接口缺失而编译失败。
2. **🟢 绿**：实现接口 + 各平台文件，调用方改为 `use crate::platform::...`，测试转绿。
3. **🔵 重构**：删除原函数内 cfg 块，`cargo test` 全绿。

## 验证命令

```bash
# Rust 编译检查
cargo check --manifest-path src-tauri/Cargo.toml

# Rust 测试（含 process_reaper 的 unix 测试）
cargo test --manifest-path src-tauri/Cargo.toml

# Rust lint（fmt + clippy）
pnpm lint

# 交叉编译（如本机已安装 target；否则 CI 验证）
cargo check --target x86_64-pc-windows-msvc --manifest-path src-tauri/Cargo.toml
cargo check --target x86_64-unknown-linux-gnu --manifest-path src-tauri/Cargo.toml
```

## 依赖顺序

```
第一批（reveal → process_tree → process_memory → host_path）
  └─ 每主题独立提交、独立验证
第二批（devtools → git_credential）
  └─ devtools 依赖 async_trait（项目已有），回归重点验证 macOS detach 行为
```

## 回滚

- 每个主题独立提交；若某主题回归，单独 revert 该主题迁移。
- 纯移动迁移，行为零变化，回滚成本低。

## 非目标

- 不迁移 `app_menu.rs`、`terminal/mod.rs` shell 选择、`job_object`/`wsl` 模块。
- 不新增/改动 CI 多平台矩阵（`.github/workflows/ci.yml` 已存在三平台矩阵，作为行为层兜底）。
- 不改变任何平台逻辑实现。
