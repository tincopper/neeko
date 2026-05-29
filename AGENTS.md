# Repository Guidelines

## Project Overview

Neeko 是一个基于 Tauri 2 与 React 18 的桌面应用，用于统一管理多项目 AI Agent 会话。应用支持三类项目源。

1. 本地项目
2. WSL 项目
3. SSH 远程项目

核心目标是将终端会话、Git 操作、文件变更、IDE 启动与 Skill 管理聚合到同一窗口，并保持会话可恢复。

## Architecture and Data Flow

### Backend 主链路

`src-tauri/src/main.rs` 调用 `neeko_lib::run`。

`src-tauri/src/app.rs` 负责 Tauri Builder 组装。

1. 初始化日志与 PATH
2. 注入 `SkillStore` 与 `AppStateWrapper`
3. 在 setup 阶段恢复 session、启动 watcher、加载自定义 agent
4. 注册命令处理器

命令注册入口当前为。

```rust
.invoke_handler(crate::neeko_invoke_handler!())
```

`src-tauri/src/commands/mod.rs` 中 `neeko_invoke_handler!` 维护完整命令清单。该宏当前是命令注册单一事实源。

### Frontend 主链路

`src/main.tsx` 挂载应用。

`src/App.tsx` 仅负责页面拼装。

1. 调用 `useAppContainer`
2. 初始化阶段显示 `SplashScreen`
3. 正常阶段挂载 `TitleBar`、`AppLayout`、`AppModals`、`AppToast`

状态协同由 hooks 与 store 完成。

1. 组合入口 `src/hooks/useAppContainer.ts`
2. 全局状态 `src/store/appStore.ts`
3. 类型定义 `src/types/`

### 关键数据流

1. UI 交互触发 hooks
2. hooks 通过 `@tauri-apps/api/core` 的 `invoke` 调用 Rust 命令
3. 命令通过 `State<AppStateWrapper>` 访问 manager
4. manager 完成 Git、PTY、SSH、存储、watcher 操作
5. 结果回传前端并更新 store

## Key Directories

| 路径 | 用途 |
| --- | --- |
| `src/` | React 前端代码，含组件、hooks、store、types、utils |
| `src/testing/` | 前端测试 setup 与工厂 |
| `src-tauri/src/` | Rust 后端源码，含 app、commands、models、manager |
| `src-tauri/tests/` | Rust 测试入口与单元测试模块 |
| `.trellis/` | AI 任务流系统，含 workflow、spec、task 脚本 |
| `docs/` | 产品文档与截图资产 |

## Development Commands

### 常用开发命令

```bash
pnpm install
pnpm tauri dev
pnpm tauri build
```

### 质量与类型检查

```bash
pnpm lint
pnpm type-check
cargo check --manifest-path src-tauri/Cargo.toml
```

### 测试命令

```bash
pnpm test
pnpm test:run
pnpm test:coverage
cargo test --manifest-path src-tauri/Cargo.toml
```

## Code Conventions and Common Patterns

### Rust 命令层约定

1. 命令函数使用 `#[tauri::command]`。
2. 返回类型统一为 `Result<T, AppError>`。
3. 状态注入使用 `State<AppStateWrapper>`。
4. 异步命令优先使用 `State<'_, AppStateWrapper>`。
5. 错误边界统一使用 `map_err(AppError::from)`。

### 命令注册约定

当前有效模式为 `neeko_invoke_handler!` 平坦清单注册。

1. 在域模块新增命令实现，例如 `commands/project.rs`
2. 通过 `commands/mod.rs` 聚合导出
3. 将命令路径加入 `neeko_invoke_handler!` 清单

说明。

`commands/wsl.rs`、`commands/remote.rs`、`skill/commands.rs` 内存在 `wsl_commands!`、`remote_commands!`、`skill_commands!` 宏定义，但当前 `app.rs` 注册入口使用 `neeko_invoke_handler!`。

### React 组织约定

1. 页面容器逻辑下沉到 hooks。
2. `App.tsx` 维持组合层职责。
3. 跨域状态通过 store 与容器 hook 协调。
4. 共享类型集中在 `src/types/`。

### 错误与并发

1. manager 中共享状态使用 Mutex 或内部并发容器。
2. 避免跨 await 持有锁。
3. 平台特定逻辑通过 `cfg` 分支处理。

## Important Files

| 文件 | 作用 |
| --- | --- |
| `src-tauri/src/app.rs` | Tauri 启动与命令注册入口 |
| `src-tauri/src/commands/mod.rs` | 命令模块聚合与 `neeko_invoke_handler!` |
| `src-tauri/src/app_state.rs` | `AppStateWrapper` 组装中心 |
| `src-tauri/src/error.rs` | `AppError` 定义与错误转换 |
| `src/App.tsx` | 前端组合根组件 |
| `src/hooks/useAppContainer.ts` | 前端主协调 hook |
| `package.json` | 前端脚本与工具链入口 |
| `src-tauri/Cargo.toml` | Rust 依赖与目标配置 |
| `src-tauri/tauri.conf.json` | Tauri 构建与窗口配置 |
| `.trellis/workflow.md` | AI 开发流程规范 |
| `docs/neeko-development-spec.md` | 全栈 Feature-Based / Domain-Driven 架构规范 |

## Runtime and Tooling Preferences

1. 包管理器使用 pnpm，版本锁定为 `9.12.2`。
2. Node 版本建议 `18+`。
3. Rust edition 为 `2021`。
4. 前端开发端口固定 `1420`，与 `tauri.conf.json` 中 `devUrl` 对齐。
5. 默认使用 `pnpm` 命令，不混用 npm 与 yarn。

## Testing and QA

### 前端测试

1. 测试框架为 Vitest。
2. 环境为 jsdom。
3. setup 文件为 `src/testing/setup.ts`。
4. 测试匹配规则见 `vitest.config.ts` 的 `include`。

### 后端测试

1. 入口文件 `src-tauri/tests/unit.rs`。
2. 子模块位于 `src-tauri/tests/unit/`。
3. 代码内 `#[cfg(test)]` 测试也会随 `cargo test` 执行。

### 最小回归集

```bash
pnpm lint
pnpm type-check
pnpm test:run
cargo test --manifest-path src-tauri/Cargo.toml
```

## AI Assistant Workflow Notes

开发前执行以下流程。

1. `python3 ./.trellis/scripts/get_context.py`
2. 阅读相关 spec index
3. 创建或选择任务目录
4. `task.py init-context` 与 `task.py add-context`
5. `task.py start` 激活任务上下文

收尾流程。

1. 运行质量命令并确认通过
2. 同步必要 spec 文档
3. 执行会话记录脚本

```bash
python3 ./.trellis/scripts/add_session.py --title "<title>" --commit "<hash>"
```

## Quick Change Playbooks

### 新增 Tauri 命令

1. 在对应域文件添加命令函数。
2. 保持返回类型 `Result<T, AppError>`。
3. 将命令加入 `neeko_invoke_handler!`。
4. 补充必要测试并执行回归命令。

### 修改前端容器逻辑

1. 优先修改 `useAppContainer` 或相关 domain hook。
2. 避免把业务逻辑回填到 `App.tsx`。
3. 更新类型定义并跑 `pnpm type-check`。

### 变更构建或权限配置

1. 同步检查 `package.json`、`vite.config.ts`、`tauri.conf.json`、`capabilities/default.json`。
2. 验证 `pnpm tauri dev` 与 `pnpm tauri build`。

<!-- TRELLIS:START -->
# Trellis Instructions

These instructions are for AI assistants working in this project.

This project is managed by Trellis. The working knowledge you need lives under `.trellis/`:

- `.trellis/workflow.md` — development phases, when to create tasks, skill routing
- `.trellis/spec/` — package- and layer-scoped coding guidelines (read before writing code in a given layer)
- `.trellis/workspace/` — per-developer journals and session traces
- `.trellis/tasks/` — active and archived tasks (PRDs, research, jsonl context)

If a Trellis command is available on your platform (e.g. `/trellis:finish-work`, `/trellis:continue`), prefer it over manual steps. Not every platform exposes every command.

If you're using Codex or another agent-capable tool, additional project-scoped helpers may live in:
- `.agents/skills/` — reusable Trellis skills
- `.codex/agents/` — optional custom subagents

Managed by Trellis. Edits outside this block are preserved; edits inside may be overwritten by a future `trellis update`.

<!-- TRELLIS:END -->
