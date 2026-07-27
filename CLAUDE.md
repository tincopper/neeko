# Neeko — CLAUDE.md

> Claude Code 项目上下文。核心规范见 `AGENTS.md`，本文件仅补充 Claude Code 角色与快捷键速查。

## 项目概览

**Neeko**：基于 Tauri 2.0 + React 18 的桌面应用，统一管理多项目 AI Agent 会话。

- **版本**: 1.0.4 | **标识符**: `com.neeko.app`
- **前端**: React 18 + TypeScript + Vite | **后端**: Rust + Tauri 2.0 + tokio
- **包管理器**: pnpm `9.12.2` | **Node**: 18+ | **Rust edition**: 2021

> 完整目录结构、架构与数据流、开发规范、测试指南见 **`AGENTS.md`**（单一事实源）。

## 常用命令速查

| 命令 | 用途 |
|------|------|
| `pnpm tauri dev` | 启动开发模式 |
| `pnpm tauri build` | 构建发布版本 |
| `pnpm type-check` | 前端类型检查 |
| `pnpm lint` | Rust lint（fmt + clippy） |
| `pnpm lint:fe` | 前端 lint（ESLint + tsc） |
| `pnpm test:run` | 运行前端测试 |
| `cargo test --manifest-path src-tauri/Cargo.toml` | 运行 Rust 测试 |
| `cargo check --manifest-path src-tauri/Cargo.toml` | Rust 编译检查 |

## 键盘快捷键

| 快捷键 | 功能 |
|--------|------|
| `Ctrl+1` ~ `Ctrl+9` | 跳转到第 N 个项目 |
| `Ctrl+Q` | 循环切换项目 |
| `Ctrl+Alt+T` / `Ctrl+W` | 打开/关闭副终端 |
| `Ctrl+O` | 在 IDE 中打开项目 |
| `Ctrl+N` | 循环切换 Worktree 终端 |
| `Ctrl+R` | 手动刷新终端 |
| `Escape` | 关闭设置面板 |

## 预置 Agent & IDE

- **Agent**: opencode, claude-code, gemini, codex, qoder, codebuddy
- **IDE**: VS Code, Cursor, Zed, IntelliJ IDEA, GoLand, RustRover, PyCharm

## 架构要点

- **终端缓存 key**: `{projectId}` / `{projectId}:side` / `{projectId}:wt:{worktreePath}` / `wsl:{distro}:{projectId}` / `remote:{entryId}:{projectId}`
- **SSH IO**: `tokio::select!` 三路并发（input / resize / output）
- **Agent 启动延迟**: 本地即时 / WSL 500ms / SSH 800ms
- **持久化**: `~/.neeko/sessions.json` + `~/.neeko/config.json`

## 已知问题

- SSH 凭据重连自动填充可能有边界情况
- SSH 路径自动补全下拉可能有 z-index 问题
- 自定义 IDE 的 icon 解析不支持

## 相关文档

- `docs/neeko-development-spec.md` — 全栈架构规范
- `docs/ARCHITECTURE.md` — 架构总览
- `docs/REQUIREMENTS.md` — 完整需求文档
