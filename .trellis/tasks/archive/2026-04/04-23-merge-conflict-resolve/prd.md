# 合并冲突解决: enhance/ui_clean_code -> main

## 背景

`enhance/ui_clean_code` 分支进行了后端模块化重构（lib.rs 拆分、models 重命名、错误处理抽取），同时 main 分支合入了 marketplace 功能（skillssh_api、git_fetcher、v3 migration）。合并时产生了 6 个冲突文件。

## 冲突分析

### 冲突 1: `src-tauri/src/lib.rs` — 结构性重构冲突

| 分支 | 变化 |
|------|------|
| HEAD (enhance/ui_clean_code) | 278 行 -> 20 行模块声明。提取 `AppStateWrapper` 到 `app_state.rs`，`run()` 到 `app.rs`，命令到 `commands/mod.rs`，错误类型到 `error.rs`，`state` 重命名为 `models` |
| main | 保持原结构，无结构性变化 |

**解决策略**: 采用 HEAD 的模块化结构（保留 20 行版本）。main 对 lib.rs 本身没有功能性修改，所有功能已在拆分后的模块中存在。

**解决步骤**:
1. 保留 HEAD 的 20 行模块声明版本
2. 确认 main 分支的 `state` → `models` 重命名已包含在 HEAD 中
3. 确认 `pub` 可见性变化正确（commands、error、models、remote、storage、terminal、utils、watcher 均为 pub）

### 冲突 2: `src-tauri/src/skill/mod.rs` — 模块声明冲突

| 分支 | 新增模块 |
|------|----------|
| HEAD | `pub mod tool_adapters;` `pub mod types;` |
| main | `pub mod skillssh_api;` `pub mod git_fetcher;` |

**解决策略**: 保留双方新增的模块声明，按字母序排列。

**解决后应为**:
```rust
pub mod central_repo;
pub mod commands;
pub mod content_hash;
pub mod git_fetcher;
pub mod installer;
pub mod migrations;
pub mod scanner;
pub mod skill_metadata;
pub mod skill_store;
pub mod skillssh_api;
pub mod sync_engine;
pub mod tool_adapters;
pub mod types;
```

### 冲突 3: `src-tauri/src/skill/migrations.rs` — 代码删除 vs 保留

| 分支 | 变化 |
|------|------|
| HEAD | 删除了 `v2 -> v3` migration、`add_column_if_missing`、`validate_identifier`、`has_column` 辅助函数 |
| main | 保留上述代码（marketplace 功能依赖 v3 migration） |

**解决策略**: 采用 main 的版本，保留 v3 migration 和辅助函数。HEAD 删除这些代码是误操作（这些函数和 migration 是 marketplace 功能的一部分，需要保留）。

**解决步骤**:
1. 保留 `v2_to_v3` migration
2. 保留 `add_column_if_missing`、`validate_identifier`、`has_column` 辅助函数
3. 保留相关测试

### 冲突 4: `src/hooks/useSkillInstall.ts` — 功能 + 格式冲突

| 分支 | 变化 |
|------|------|
| HEAD | 3 空格缩进，缺少 `discoveredSkills`/`importDiscoveredSkill`/`clearDiscovered` |
| main | 2 空格缩进，包含完整的 discovered skills 功能 |

**解决策略**: 采用 main 的版本。main 包含完整的功能实现，且 2 空格缩进是 TS/React 标准。

**解决步骤**:
1. 整个文件采用 main 版本
2. 确认 `installGit` 参数命名（main 有具名参数 `url`/`branch`，HEAD 有下划线前缀 `_url`/`_branch`）——采用 main 的命名

### 冲突 5: `src/contexts/skill-context.tsx` — 纯格式冲突

| 分支 | 变化 |
|------|------|
| HEAD | 3 空格缩进 |
| main | 2 空格缩进 |

**解决策略**: 采用 main 的 2 空格缩进。内容无功能差异。

### 冲突 6: `src/components/skills/LocalSkillContent.tsx` — 格式 + 微调

| 分支 | 变化 |
|------|------|
| HEAD | 3 空格缩进，`handleEdit` 参数为 `_name`/`_skillContent` |
| main | 2 空格缩进，`handleEdit` 有 `console.log` 输出 |

**解决策略**: 采用 main 的版本（2 空格缩进 + 保留 console.log 作为开发期调试辅助）。

## 解决优先级

1. **后端冲突（冲突 1-3）**: 先解决，因为影响编译
2. **前端冲突（冲突 4-6）**: 后解决，相对简单

## 验证标准

- [ ] `cargo check --manifest-path src-tauri/Cargo.toml` 通过
- [ ] `npx tsc --noEmit` 通过
- [ ] `grep -rn '<<<<<<' src/ src-tauri/src/` 无残留冲突标记
- [ ] 所有 6 个冲突文件状态为 resolved

## 技术备注

- HEAD 分支的 3 空格缩进是此次重构引入的，应统一为项目标准的 2 空格（TS）/ 4 空格（Rust）
- lib.rs 的模块化重构是此分支的核心价值，必须保留
- main 的 marketplace 功能（skillssh_api、git_fetcher、v3 migration）是正在进行中的功能，不能丢弃
