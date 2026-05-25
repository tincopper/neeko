# Phase 5.1: Git 解析器提取（parsers.rs）

## Goal

将 `git/remote.rs` 中的共享解析函数提取到独立 `git/parsers.rs` 模块，消除 `wsl.rs` 对 `remote.rs` 的反向依赖。

## What I already know

### 当前解析函数位置

| 函数 | 当前位置 | 行号 | WSL 引用 | Remote 引用 |
|---|---|---|---|---|
| `parse_unified_diff` | `git/local.rs` | L628 | ✅ via `super::local::` | ✅ via `super::local::` |
| `collapse_diff_context` | `git/local.rs` | L716 | ✅ via `super::local::` | ✅ via `super::local::` |
| `parse_git_info_output` | `git/remote.rs` | L89 | ✅ via `super::remote::` | 自身 |
| `parse_status_line` | `git/remote.rs` | L204 | ✅ via `super::remote::` | 自身 |
| `parse_commit_log_output` | `git/remote.rs` | L326 | ✅ via `super::remote::` | 自身 |
| `extract_commit_hash_from_output` | `git/remote.rs` | L357 | ✅ via `super::remote::` | 自身 |
| `build_file_tree_from_find` | `git/remote.rs` | L374 | ✅ via `super::remote::` | 自身 |
| `collect_file_tree_children` | `git/remote.rs` | L450 | ✅ via `super::remote::` | 自身 |

### 现有依赖链

```
local.rs ────────────────────────────────────┐
  │                                            │
  ├── parse_unified_diff ─────────── shared ──┤
  └── collapse_diff_context                    │
                                          parsed from
remote.rs ─────────────────────────────┐    │
  │                                     │    │
  ├── parse_git_info_output ────────────┤    │
  ├── parse_status_line                 │    │
  ├── parse_commit_log_output           ├────┘
  ├── extract_commit_hash_from_output   │
  ├── build_file_tree_from_find         │
  └── collect_file_tree_children        │
                                   wsl.rs imports
wsl.rs ────────────────────────────────┘
  (imports from both local.rs and remote.rs)
```

### 目标架构

```
local.rs ← parsers.rs → wsl.rs
              ↑
          remote.rs
```

## Requirements

1. 创建 `git/parsers.rs`，移入全部 8 个解析函数
2. 更新 `git/mod.rs`：添加 `mod parsers` + `pub use parsers::*`
3. 更新 `git/local.rs`：删除 `parse_unified_diff` / `collapse_diff_context` 定义，改为 `use super::parsers::`
4. 更新 `git/remote.rs`：删除 6 个函数定义，改为 `use super::parsers::`
5. 更新 `git/wsl.rs`：导入路径从 `super::local` / `super::remote` 改为 `super::parsers`
6. 函数签名不变，零行为变更

## Acceptance Criteria

- [ ] `cargo check --manifest-path src-tauri/Cargo.toml` 零 error
- [ ] `cargo test --manifest-path src-tauri/Cargo.toml` 全部通过
- [ ] `npx tsc --noEmit` 零 error（前端无变更）
- [ ] `pnpm test:run` 全部通过

## Out of Scope

- 不创建 GitTransport trait
- 不创建 commands/git_unified.rs
- 不删旧文件（local.rs / wsl.rs / remote.rs）
- 不修改前端 invoke 调用

## Technical Notes

- 解析函数全部为纯函数（输入字符串 → 输出结构体），无副作用
- `pub(crate)` 可见性保持不变
- `parse_status_line` 当前为 `pub(crate)`，wsl.rs 通过 `super::remote::parse_status_line` 调用
