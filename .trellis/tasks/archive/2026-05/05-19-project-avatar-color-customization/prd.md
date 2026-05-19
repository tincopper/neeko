# Project Avatar Color Customization

## Goal

让侧边栏每个项目（Local / WSL / SSH 三端）的字母色块头像颜色：(1) 用户可在 ProjectSettingsDialog 里覆盖；(2) 创建项目时默认从调色板随机挑一色，取代当前 `src/utils/projectAvatar.ts` 中按项目名 DJB2 hash 的算法（短名 + 仅 10 色 → 容易撞，截图里 `mife-admin` 与 `neeko` 同蓝即典型案例）。

## What I already know

- 调色板：`src/utils/projectAvatar.ts` 中 `AVATAR_COLORS`，共 10 色
- 头像样式生成：`getAvatarStyle(name)` 返回 `{ color, backgroundColor: color+'26' }`，被 `ProjectGroup.tsx` 与 `TitleBar.tsx` 共同消费
- 缩写派生：`getProjectInitials(name)` 不动
- Rust 数据模型：
  - 内存 `Project`（`src-tauri/src/models/project.rs:67`）
  - 持久化 `ProjectSession`、`WSLProjectSession`、`RemoteProjectSession`（`src-tauri/src/models/session.rs`）；后两者已用 `#[serde(default)]` 兼容缺字段
- 现有逐字段 setter 模式（仅 Local）：`set_project_agent` / `set_project_ide` / `set_project_collapsed`；WSL/SSH 项目级字段当前走 `save_session` 整块保存
- 现有 dialog：`ProjectSettingsDialog`（Agent + IDE，每行 dropdown 风格）

## Requirements

- **数据模型**：
  - `Project` / `WSLProject` / `RemoteProject` 的内存与持久化结构均加 `avatar_color: Option<String>` 字段
  - 旧 sessions.json 通过 `#[serde(default)]` 自动迁移读为 `None`
- **默认色行为**：
  - 创建项目时（Local / WSL / SSH 三端）从 `AVATAR_COLORS` 随机挑一色，写入 `avatar_color`，立即持久化
  - 旧项目（`avatar_color == None`）渲染时 fallback 到当前 DJB2 hash 算法，不强制迁移
- **覆盖入口**（实施过程中由参考图修正）：
  - 全局 Settings → Project 子面板（`src/components/settings/ProjectPanel.tsx`）新增 Appearance section，与 Agent / IDE 同款"即时保存"模式（无 Save 按钮）
  - **Picker 布局参考用户提供的设计图**：单行水平排列的**圆形 swatch**（每个 ≈ 22~24px 直径，间距均匀），不使用方格 grid；调色板仍为现有 10 色（`AVATAR_COLORS`）；当前选中色 swatch 高亮（`ring-2 ring-white/80 scale-110`）
  - 提供 `Reset to default`（清回 `None`，重新走 hash 兜底）；UI 形式为 section header 旁边的链接，仅在已有覆盖色时显示
  - 不改右键菜单 `ProjectSettingsDialog`（右键 dialog 仍只管 Agent / IDE 两项）
  - 不在头像上加 popover
- **后端命令**：
  - 新增三个对称 setter：`set_project_color` (Local) / `wsl_set_project_color` / `remote_set_project_color`
  - 各 setter 同时更新内存和持久化（沿用现有 `set_project_agent` 风格）
- **渲染层**：
  - `getAvatarStyle` 升级为接受 `(input: { name: string; color?: string | null })`：优先用 `color`，缺省走 name → hash 兜底
  - `ProjectGroup.tsx` 与 `TitleBar.tsx` 都改为传 `{ name, color: project.avatar_color }`
- **三端对齐**（数据 + 后端命令 + UI override 入口全部就位）：
  - 数据层：`avatar_color` 三端 schema 完全对齐
  - 后端命令：3 个 setter 全部实现并注册（`set_project_color` / `wsl_set_project_color` / `remote_set_project_color`）
  - Add-time 默认色：三端均在创建流程随机选色
  - **UI override 入口**：三端均已就位
    - Local：`src/components/settings/ProjectPanel.tsx`，路由 `project:<projectId>`
    - WSL：`src/components/settings/WslProjectPanel.tsx`，路由 `wsl:<distro>:<projectId>`
    - SSH：`src/components/settings/RemoteProjectPanel.tsx`，路由 `remote:<entryId>:<projectId>`
  - 共享 `<ProjectAppearanceSection>`（`src/components/settings/ProjectAppearanceSection.tsx`）由三端 panel 同款消费
  - **Agent / IDE override 入口**：仅 Local panel 提供。后端 `set_project_agent` / `set_project_ide` 仅作用于 `ProjectManager`（Local-only），对 wsl/remote projectId 无效，因此 wsl/remote panel 暂不暴露 Agent/IDE 选项（详见 Out of Scope）

## Acceptance Criteria

- [ ] 创建新项目时 `avatar_color` 立即写入持久化（重启不丢）
- [ ] 旧项目（`avatar_color == None`）首次渲染走 hash，编辑过一次后持久化为具体色
- [ ] **全局 Settings → Project 子面板**（`ProjectPanel.tsx`）的 Appearance section 显示一行 10 个圆形 swatch（沿用 `AVATAR_COLORS`）；点击切换并显示选中态；Reset 按钮清回默认；点击即时同步 store + 后端 + `ProjectGroup` 头像
- [ ] 右键菜单 `ProjectSettingsDialog` 回到只有 Agent + IDE，无 Appearance 残留
- [ ] TitleBar 顶部 Avatar 与侧边栏 Avatar 一致
- [ ] 三端（Local / WSL / SSH）数据 + 后端命令 + add-time 默认色一致；**UI override 入口三端均已就位**（Local 走 `ProjectPanel.tsx`，WSL 走 `WslProjectPanel.tsx`，SSH 走 `RemoteProjectPanel.tsx`，共享 `<ProjectAppearanceSection>` 子组件）
- [ ] 旧 sessions.json 不报错
- [ ] `npx tsc --noEmit` 通过
- [ ] `cargo check --manifest-path src-tauri/Cargo.toml` 0 errors
- [ ] `pnpm test:run` 通过

## Definition of Done

- 单测：
  - `projectAvatar.ts`：新签名优先级（color 优先于 name hash）、Reset 行为
  - Rust：`ProjectSession` / `WSLProjectSession` / `RemoteProjectSession` 的 serde 往返（缺 `avatar_color` 字段时反序列化为 `None`）
- 行为变化在 PR description 显式说明（旧项目颜色仍为 hash 兜底，新项目走随机；用户可手动改）

## Technical Approach

**前端**：
- `getAvatarStyle({ name, color })`：单一 helper，三处调用点（`ProjectGroup`、`TitleBar`、未来若有的位置）
- `ProjectSettingsDialog` 新增 `Appearance` section：水平一行 10 个圆形 swatch（每个 ≈ 22~24px 直径，纯色填充；当前选中色描白边或加缩放高亮）+ Reset 按钮；保存时 invoke 对应 setter
- `Project` / `WSLProject` / `RemoteProject` 的 TS 类型加可选字段 `avatar_color?: string | null`

**后端**：
- 数据模型字段：`avatar_color: Option<String>`，`#[serde(default)]` 兼容旧文件
- 三个 setter：
  - `set_project_color(project_id, color: Option<String>) -> Result<(), String>`（Local）
  - `wsl_set_project_color(distro, project_id, color: Option<String>)` 
  - `remote_set_project_color(entry_id, project_id, color: Option<String>)`
- 三个 add 命令：在创建分支末尾用 `rand::thread_rng().gen_range(0..AVATAR_COLORS.len())` 抽一色，写入 `avatar_color` 后再持久化（仅用现有 rand crate；如未引入则前端随机后传给后端写入，后端不做随机）
- 持久化：现有 `save_session` 自动覆盖；setter 内显式调一次保证立即落盘

**Color 来源约束**：调色板 10 色作为 single source of truth，前后端共享同一份字符串列表（前端 `AVATAR_COLORS` 维持原样；后端不内嵌列表，setter 不校验入参——前端只允许从该列表选）

## Decision (ADR-lite)

**Context**：原 `getAvatarStyle(name)` 用 DJB2 hash 在 10 色调色板里取模，短名 + 小调色板下撞色频繁；用户需要"提高区分度"以及"个性化能力"。

**Decision**：
- 不重做 hash 算法（那只是"换一种撞色姿势"）
- 引入 per-project 持久化字段 `avatar_color`，新项目随机选一色立即固化；用户在 Settings 里覆盖
- 旧项目 `None` 时仍走 hash 兜底，避免一次性大变样

**Consequences**：
- 优：用户掌控、未来扩展空间（调色板换、自定义 hex、暗色亮色双套）只动一处
- 缺：随机仍可能撞色（用户接受这种简单实现，可手动改）
- 风险：三端 schema/UI 改动需同步——通过对称三个 setter 与共享的 dialog UI 缓解

## Out of Scope

- 不引入自由 hex 输入 / 颜色拾取器（仅在调色板内选）
- 不调整调色板本身（保持 10 色）
- 不重做 hash 兜底算法（旧项目仍按 name hash）
- 不为头像添加图标 / emoji（保留字母）
- 不扩展到 worktree 行 / Session ghost icon（仅项目卡 avatar）
- 不重构 sessions.json 整体结构
- WSL/SSH panel 不提供 Agent / IDE 覆盖入口：现有后端 `set_project_agent` / `set_project_ide` 仅查 `ProjectManager`（local-only），对 wsl/remote projectId 无效。要支持需要新增 wsl/remote 专属 setter（修改 `wsl_entries[].projects[].selected_*` 并 `save_session`），不在本任务范围内

## Implementation Plan (single PR)

本任务面比较紧凑，一个 PR 足够：

- **PR1 — avatar color end-to-end**：
  - Rust：三处 schema 加字段 + 三个 setter + 三个 add 路径默认色随机注入 + serde 兼容测试
  - 前端：`getAvatarStyle` 升级签名 + `ProjectGroup` / `TitleBar` 适配 + `ProjectSettingsDialog` 新增 Color 行 + 三端 invoke 路径 + 单测
  - CHANGELOG 一行

如实施时发现 backend 改动单独可发版（用户同时升级）则可拆 PR1a (Rust schema + setters) / PR1b (frontend dialog)，但建议一次提交避免过渡态。

## Technical Notes

- 关键文件：
  - 前端：`src/utils/projectAvatar.ts`、`src/types/project.ts`、`src/types/connection.ts`、`src/components/project/ProjectGroup.tsx`、`src/components/project/ProjectSettingsDialog.tsx`、`src/components/layout/TitleBar.tsx`
  - 后端：`src-tauri/src/models/project.rs`、`src-tauri/src/models/session.rs`、`src-tauri/src/commands/{project,wsl_project,remote_project,agent,ide}.rs`、`src-tauri/src/storage.rs`（如存在迁移）
- 现有命令模式参考：`set_project_agent`（`src-tauri/src/commands/agent.rs:80`）、`set_project_ide`（`src-tauri/src/commands/ide.rs:7`）、`set_project_collapsed`（`src-tauri/src/commands/project.rs:119`）
- 调色板：`src/utils/projectAvatar.ts:3` 的 `AVATAR_COLORS` 共 10 色
