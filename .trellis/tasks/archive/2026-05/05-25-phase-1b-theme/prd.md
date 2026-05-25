# Phase 1B Theme 编排收尾

## Goal

完成 `docs/architecture-optimization-impl-plan.md` 中 Phase 1B 的剩余步骤 (7-11)，收尾 Theme 模块重组。

## What I already know

* `theme/` 目录已创建，含 `common.rs`、`opencode.rs`、`pi.rs`
* `common.rs` 已提取公共函数：`map_theme_name`、`base64_encode`、`shell_escape`、`read_neeko_theme`、`read_config_bool`、`get_current_theme`
* `opencode.rs` 和 `pi.rs` 已通过 `super::common::` 使用公共函数
* **阻塞项**：旧的 `opencode_theme.rs` 和 `pi_theme.rs` 文件未删除，`lib.rs` 仍保留旧模块声明
* 所有外部调用方 (`app.rs`, `terminal.rs`, `remote.rs`, `commands/config.rs`) 仍引用 `crate::opencode_theme::` / `crate::pi_theme::`

## Requirements

1. 删除旧文件 `opencode_theme.rs` 和 `pi_theme.rs`
2. 清理 `lib.rs` 旧模块声明
3. 全部外部引用从 `crate::opencode_theme::` → `crate::theme::opencode::`，`crate::pi_theme::` → `crate::theme::pi::`
4. 在 `theme/mod.rs` 添加 `ThemeContext` enum、`install_all_global_themes()`、`install_wsl_themes()`、`write_project_theme_config()`
5. 简化 `app.rs`（2 次 install 调用 → 1 次）
6. 简化 `terminal.rs`（移除重复的 `read_neeko_theme()`，使用统一 API）
7. 简化 `remote.rs`（更新所有引用）
8. 简化 `commands/config.rs`（使用 `write_project_theme_config()`）

## Acceptance Criteria

* [ ] `cargo check` 零 error
* [ ] `cargo test` 全通过
* [ ] 无 `opencode_theme.rs` / `pi_theme.rs` 残留
* [ ] `lib.rs` 中无 `pub mod opencode_theme` / `pub mod pi_theme`

## Out of Scope

* 不修改前端代码
* 不改变任何运行时行为
