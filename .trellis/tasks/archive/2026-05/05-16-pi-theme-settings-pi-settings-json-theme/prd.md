# Pi / OpenCode Theme Settings 可配置化

## Goal

将 neeko 自动写入项目级 agent 配置文件（`.pi/settings.json` + `.opencode/tui.json`）的行为改为可配置项，默认关闭，用户启用后才生效。避免未经用户明确同意即修改项目文件。

## What I already know

* 当前有 **5 条路径** 会写 agent 项目配置文件：
  1. `app.rs:run()` → 全局主题安装（幂等，不碰项目文件）
  2. 本地 PTY 创建 → `write_project_pi_settings()` + `write_project_tui_config()`
  3. WSL PTY 创建 → Pi/OC 主题安装 + `write_wsl_pi_settings()` + `write_wsl_tui_config()`
  4. SSH 远程连接 → Pi/OC 主题安装 + `write_remote_pi_settings()` + `write_remote_tui_config()`
  5. 前端主题切换 → `sync_agent_theme` command → 批量同步 local + WSL
* AppConfig 类型定义在 `src/types/app.ts`（TypeScript），Rust 侧用 `serde_json::Value` 存储
* 配置持久化路径：`~/.neeko/config.json`
* 配置文件通过 `save_config` / `load_config` Tauri 命令读写
* 前端 `useAppConfig.ts` 管理配置状态，theme 变化时触发 `sync_agent_theme`
* 设置面板在 `src/components/settings/AppearancePanel.tsx`，含 theme 选择器

## Requirements

* [ ] 新增配置字段 `enablePiThemeSync: boolean`，默认 `false`
* [ ] 新增配置字段 `enableOpenCodeThemeSync: boolean`，默认 `false`
* [ ] Pi 侧：所有 `write_project_pi_settings` / `write_wsl_pi_settings` / `write_remote_pi_settings` 调用点受 `enablePiThemeSync` 控制
* [ ] OpenCode 侧：所有 `write_project_tui_config` / `write_wsl_tui_config` / `write_remote_tui_config` 调用点受 `enableOpenCodeThemeSync` 控制
* [ ] `sync_agent_theme` 命令中 Pi + OC 同步部分分别受各自开关控制
* [ ] 前端 AppearancePanel 新增两个独立 Toggle 开关
* [ ] 配置持久化：`~/.neeko/config.json` 正确读写新字段

## Decision (ADR-lite)

* **Config fields**: `enablePiThemeSync` + `enableOpenCodeThemeSync` (boolean, default: `false`)
* **Scope**: 仅控制项目级配置文件写入（`.pi/settings.json` + `.opencode/tui.json`），**不控制** 全局主题文件安装（`install_*_theme_files` 系列，因幂等且不触碰用户项目文件）
* **UI 位置**: AppearancePanel 中 theme 选择器下方，新增两个 Toggle 开关（Pi 同步 / OpenCode 同步）
* **Rust 侧读取方式**: 新增工具函数从 `~/.neeko/config.json` 读取对应字段（复用 `read_neeko_theme()` 模式），PTY 创建/SSH 连接时先检查
* **前端门控方式**: `sync_agent_theme` 命令内部读取 config 分别门控 Pi 和 OC 部分

## Acceptance Criteria

* [ ] 默认状态下（两个开关均 `false`），创建本地/WSL/SSH 终端不写入任何 agent 项目配置文件
* [ ] 默认状态下，切换主题时 `sync_agent_theme` 不写入 Pi settings 和 OC tui.json
* [ ] 单独开启 `enablePiThemeSync` → 仅写入 Pi settings.json
* [ ] 单独开启 `enableOpenCodeThemeSync` → 仅写入 OpenCode tui.json
* [ ] 两个开关独立生效，实时无需重启
* [ ] 配置正确持久化，重启后保持

## Definition of Done

* TypeScript + Rust 类型同步
* 所有 Pi + OC 项目级写入路径均已门控
* Lint / type-check / cargo check 通过

## Out of Scope

* 不包含全局主题文件安装 (`install_*_theme_files` 系列) 的可配置化

## Technical Notes

* 核心文件：`src-tauri/src/pi_theme.rs`、`src-tauri/src/opencode_theme.rs`、`src-tauri/src/terminal.rs`、`src-tauri/src/remote.rs`、`src-tauri/src/commands/config.rs`
* 前端：`src/types/app.ts`、`src/hooks/useAppConfig.ts`、`src/components/settings/AppearancePanel.tsx`
