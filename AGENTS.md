# Neeko — Repository Guidelines

> AI 编程助手项目上下文与开发规范。此文件是所有 AI Agent 的单一事实源（Single Source of Truth）。

## 项目概览

**Neeko** 是一个基于 Tauri 2.0 + React 18 的桌面应用，统一管理多项目 AI Agent 会话。支持三种项目类型。

1. 本地项目
2. WSL 项目
3. SSH 远程项目

核心目标是将终端会话、Git 操作、文件变更、IDE 启动与 Skill 管理聚合到同一窗口，并保持会话可恢复。

- **版本**: 1.0.4
- **标识符**: `com.neeko.app`
- **许可证**: Apache 2.0
- **包管理器**: pnpm `9.12.2`
- **Node**: 18+
- **Rust edition**: 2021
- **前端端口**: 1420（与 `tauri.conf.json` 中 `devUrl` 对齐）

## 目录结构

### 前端（Feature-Based 架构）

```
src/
├── app/                              # 应用入口
│   ├── App.tsx                       # 组合层：hooks + JSX 编排
│   ├── main.tsx                      # 入口点
│   ├── AppModals.tsx, AppProviders.tsx
│   ├── components/                   # 应用级组件（SplashScreen 等）
│   ├── hooks/
│   │   ├── useAppShell.ts            # 主协调 hook
│   │   └── index.ts
│   └── dock/                         # Dock 布局组件
├── features/                         # 21 个功能域模块
│   ├── action-menu/ agent/ browser/ connection/ conversation/
│   ├── debug/ editor/ file/ git/ lsp/ notification/
│   ├── project/ quick-open/ session/ settings/ skill/
│   ├── status-bar/ symbol-nav/ task/ terminal/ theme/
│   └── (每个域有自己的 components/ hooks/ store/)
├── shared/                           # 跨域共享
│   ├── components/                   # 共享 UI 组件
│   ├── contexts/                     # React contexts
│   ├── dock/                         # Dock 系统
│   ├── hooks/                        # 共享 hooks
│   │   ├── useToast.ts, useKeyboardShortcuts.ts
│   │   ├── useProjectActions.ts, useSplitLayout.ts
│   │   └── ...
│   ├── store/                        # zustand 状态管理
│   │   ├── projectStore.ts, gitStore.ts, connectionStore.ts
│   │   ├── editorStore.ts, browserStore.ts, dockStore.ts
│   │   ├── lspStore.ts, notificationStore.ts, taskStore.ts
│   │   └── ...
│   ├── types/                        # 全局 TypeScript 类型（按域分文件）
│   │   ├── project.ts, git.ts, connection.ts
│   │   ├── terminal.ts, agent.ts, session.ts
│   │   ├── settings.ts, task.ts, skill.ts, editorGroup.ts
│   │   └── ...
│   └── utils/                        # 共享工具函数（27 个文件）
│       ├── terminal.ts, agents.ts, distros.ts
│       ├── fileIcons.ts, idePresets.ts, platform.ts
│       └── ...
├── layout/                           # 窗口布局框架
├── lib/                              # 工具库
├── ui/                               # 通用 UI 组件
├── styles/                           # 全局样式
└── testing/                          # 测试 setup
    └── setup.ts, factories.ts
```

### 后端（Domain-Driven 模块化架构）

```
src-tauri/src/
├── main.rs                           # Tauri 应用入口
├── lib.rs                            # 模块聚合 + neeko_invoke_handler!
├── app.rs                            # Tauri Builder 组装
├── app_state.rs                      # AppStateWrapper 组装中心
├── common/                           # 共享基础设施
│   ├── error.rs                      # AppError（thiserror 枚举）
│   ├── logger.rs                     # 文件日志，写入 ~/.neeko/neeko.log
│   ├── runtime.rs                    # 异步运行时工具
│   └── ...
├── agent/                            # Agent 管理（opencode, claude-code, gemini, codex, qoder, codebuddy）
│   ├── commands.rs                   # Tauri 命令
│   ├── commands_commit.rs            # Commit 相关命令
│   ├── manager.rs                    # AgentManager
│   └── mod.rs
├── project/                          # 项目管理
│   ├── commands.rs                   # 项目 CRUD
│   ├── commands_ide.rs              # IDE 启动命令
│   └── mod.rs
├── session/                          # 会话持久化
│   ├── commands.rs
│   ├── manager.rs
│   └── mod.rs
├── terminal/                         # 终端管理（local/WSL/remote PTY）
│   ├── commands.rs
│   ├── services.rs
│   └── mod.rs
├── connection/                       # WSL + SSH 连接
│   ├── commands.rs
│   ├── services.rs
│   └── mod.rs
├── conversation/                     # 对话扫描/搜索/导出
│   ├── commands.rs
│   └── mod.rs
├── git/                              # Git 操作（git2-rs）
│   ├── commands.rs
│   ├── services/
│   └── mod.rs
├── skill/                            # Skill 管理（install, configure, tag, sync）
├── settings/                         # 应用设置管理
├── task/                             # 任务配置与执行
├── file/                             # 文件系统操作
├── browser/                          # 内置浏览器 webview
├── dap/                              # Debug Adapter Protocol
├── lsp/                              # Language Server Protocol
├── core/                             # 核心运行时与进程工具
└── theme/                            # 主题同步
```

## Architecture and Data Flow

### Backend 主链路

`src-tauri/src/main.rs` 调用 `neeko_lib::run`。

`src-tauri/src/app.rs` 负责 Tauri Builder 组装。

1. 初始化日志与 PATH
2. 注入 `SkillStore` 与 `AppStateWrapper`
3. 在 setup 阶段恢复 session、启动 watcher、加载自定义 agent
4. 注册命令处理器

命令注册入口：

```rust
.invoke_handler(crate::neeko_invoke_handler!())
```

`src-tauri/src/lib.rs` 中 `neeko_invoke_handler!` 维护完整命令清单，是命令注册单一事实源。

### Frontend 主链路

`src/app/main.tsx` 挂载应用。

`src/app/App.tsx` 组合层。

1. 调用 `useAppShell`
2. 初始化阶段显示 `SplashScreen`
3. 正常阶段挂载 `TitleBar`、`AppLayout`、`AppModals`、`AppToast`

状态协同由 hooks 与 store 完成。

1. 组合入口 `src/app/hooks/useAppShell.ts`
2. 全局状态 `src/shared/store/`（zustand）
3. 类型定义 `src/shared/types/`

### 关键数据流

1. UI 交互触发 hooks
2. hooks 通过 `@tauri-apps/api/core` 的 `invoke` 调用 Rust 命令
3. 命令通过 `State<AppStateWrapper>` 访问 manager
4. manager 完成 Git、PTY、SSH、存储、watcher 操作
5. 结果回传前端并更新 store

### 架构要点

#### 终端缓存

全局 Map 缓存，key 格式：

- 本地：`{projectId}` / `{projectId}:side` / `{projectId}:wt:{worktreePath}`
- WSL：`wsl:{distro}:{projectId}` / `wsl:{distro}:{projectId}:side`
- SSH：`remote:{entryId}:{projectId}` / `remote:{entryId}:{projectId}:side`

PTY 会话在组件卸载时保持存活（DOM detach/reattach）。

#### SSH IO 架构

`channel.make_writer()` 分离读写，`tokio::select!` 三路并发：

1. Input: `input_rx` → `channel.make_writer()`
2. Resize: `resize_rx` → `channel.window_change()`
3. Output: `channel.wait()` → `emit terminal-output-{id}`

#### Agent 自动启动延迟

- 本地：即时 | WSL：500ms | SSH：800ms

#### 持久化

- `~/.neeko/sessions.json`：项目、WSL、SSH、宽度、Worktree 状态
- `~/.neeko/config.json`：字体、Diff 模式、Shell、IDE/Agent 覆盖

## Development Commands

### 常用开发命令

```bash
pnpm install
pnpm tauri dev
pnpm tauri build
```

### 质量与类型检查

```bash
pnpm lint          # Rust fmt + clippy
pnpm lint:fe       # ESLint + TypeScript + Test typecheck
pnpm type-check    # npx tsc --noEmit
cargo check --manifest-path src-tauri/Cargo.toml
```

### 测试命令

```bash
pnpm test          # vitest watch
pnpm test:run      # vitest run
pnpm test:coverage # vitest run --coverage
cargo test --manifest-path src-tauri/Cargo.toml
```

## 架构基本原则（强制）

> 所有开发必须遵循以下原则，优先级高于具体实现细节。

### 高内聚低耦合

1. **单一职责（SRP）**：一个组件/函数/模块只有一个改变的理由。如果一个单元承担多个职责，拆分为独立单元。
2. **高内聚**：同一模块内的代码必须紧密相关。不相关的逻辑不应放在同一个文件中。
3. **低耦合**：模块间依赖必须通过明确定义的接口（API wrapper / `pub use` re-export / props/context），禁止跨域直接引用内部实现。
4. **依赖倒置（DIP）**：高层模块不依赖低层实现细节，两者都应依赖抽象（interface / trait / props）。

### 开闭原则（OCP）

1. 对扩展开放，对修改封闭。新增功能通过添加新代码（新 variant、新 strategy、新组件）实现，而非修改已有代码。
2. 策略集已知且固定时，使用 `Enum + match` 代替 `Box<dyn Trait>`（编译期 dispatch，新增 variant 强制处理所有 match）。

### DRY / KISS / YAGNI

1. **DRY**：重复逻辑出现 3 次以上必须抽象为共享函数/hook/util。
2. **KISS**：优先选择最简单的解决方案，不过度设计。
3. **YAGNI**：当前不需要的功能不实现，不预留"将来可能用到"的抽象层。

### 状态管理原则

1. **就近管理**：状态放在最近的共同祖先。局部状态用 `useState`，feature 域状态用 feature store，全局状态用 `shared/store`。
2. **禁止冗余状态**：能从派生计算得到的状态不要单独存储（用 `useMemo` 替代）。
3. **单向数据流**：数据从上层向下流动，事件从下层向上传递。禁止子组件直接修改父组件状态。

---

## TDD 开发模式（强制）

> 所有新功能开发和 Bug 修复必须遵循 Red-Green-Refactor 循环。

### Red-Green-Refactor 循环

1. **Red**：先写测试，确认测试失败（精确定义预期行为）。
2. **Green**：写最少代码让测试通过（不追求完美，只满足当前需求）。
3. **Refactor**：重构代码（保持测试通过），消除重复，提升可读性。

### 新功能开发流程

1. 先定义接口（types / function signature / props）。
2. 写测试（覆盖正常路径 + 边界情况 + 错误处理）。
3. 确认测试失败（Red）。
4. 实现功能逻辑（Green）。
5. 重构优化（Refactor）。
6. 补充集成测试（如涉及跨模块）。

### Bug 修复流程

1. 先写复现测试（回归测试，确认 Bug 可复现）。
2. 确认测试失败（Red）。
3. 修复代码（Green）。
4. 确认测试通过。
5. 检查是否有类似问题（扩展测试覆盖）。

### 测试覆盖率要求

| 层级 | 要求 | 方法 |
|------|------|------|
| 纯函数 / 工具类 | 100% | 直接调用，断言返回值 |
| Manager 逻辑（Rust） | 核心路径覆盖 | `#[test]` 函数 |
| 自定义 Hooks（TS） | 关键行为覆盖 | `renderHook` + `act` |
| 组件 | 关键交互覆盖 | `@testing-library/react` |

### 测试优先原则

- **没有测试的新代码不允许合入**。
- **修改已有代码前，先确认已有测试通过**。
- **测试必须独立**：不依赖执行顺序，不依赖外部状态。
- **测试必须快速**：单个测试 < 100ms，全量测试 < 30s。

---

## Code Conventions and Common Patterns

### Rust 命令层约定

1. 命令函数使用 `#[tauri::command]`
2. 返回类型统一为 `Result<T, AppError>`（thiserror 枚举）
3. 错误转换使用 `.map_err(AppError::from)`
4. 状态注入使用 `State<AppStateWrapper>`
5. 异步命令优先使用 `State<'_, AppStateWrapper>`
6. AppError 覆盖：Io, Git, Storage, Skill, Project, NotFound, InvalidInput, Remote, Dap, Serde, Unknown

### 命令注册约定

1. 在域模块新增命令实现，例如 `project/commands.rs`
2. 通过域模块 `mod.rs` 聚合导出
3. 将命令路径加入 `neeko_invoke_handler!`（位于 `src-tauri/src/lib.rs`）

### 前端架构约定

1. **类型管理**：所有共享接口定义在 `src/shared/types/`，按域分文件；组件内不重复定义
2. **Hook 设计**：各 feature 域管理自己的 hooks；共享 hooks 在 `src/shared/hooks/`；跨域协调在 `useAppShell` 层组合
3. **Ref 同步集中**：所有 refs 在单个 effect 中同步
4. **功能域代码**放在 `src/features/` 对应子目录
5. 页面容器逻辑下沉到 hooks，`App.tsx` 维持组合层职责

#### React 性能优化

| 模式          | 规则                                               |
| ------------- | -------------------------------------------------- |
| `React.memo`  | 列表项组件、大型布局组件、复用组件                 |
| `useMemo`     | 昂贵计算（`buildTree`、字体列表、分支过滤）        |
| `useCallback` | 跨组件回调、hooks 返回的函数                       |
| 内联对象      | 避免 JSX 中 `style={{...}}` 常量对象，提取到模块级 |
| 条件渲染      | 用三元而非 `&&`（避免 falsy 值渲染）               |
| Ref 模式      | 频繁变化的值用 ref 跟踪，在 effect 中同步          |

### 错误与并发

1. manager 中共享状态使用 Mutex 或内部并发容器
2. 避免跨 await 持有锁
3. 平台特定逻辑通过 `cfg` 分支处理
4. WSL 命令使用 `cfg!(target_os = "windows")` 门控
5. Windows 使用 `CREATE_NO_WINDOW` (0x08000000) 避免控制台闪烁

## Important Files

| 文件 | 作用 |
| --- | --- |
| `src-tauri/src/app.rs` | Tauri 启动与命令注册入口 |
| `src-tauri/src/lib.rs` | 模块聚合与 `neeko_invoke_handler!` |
| `src-tauri/src/app_state.rs` | `AppStateWrapper` 组装中心 |
| `src-tauri/src/common/error.rs` | `AppError` 定义与错误转换 |
| `src/app/App.tsx` | 前端组合根组件 |
| `src/app/hooks/useAppShell.ts` | 前端主协调 hook |
| `src/shared/store/` | zustand 全局状态管理 |
| `src/shared/types/` | TypeScript 类型定义 |
| `package.json` | 前端脚本与工具链入口 |
| `src-tauri/Cargo.toml` | Rust 依赖与目标配置 |
| `src-tauri/tauri.conf.json` | Tauri 构建与窗口配置 |
| `.trellis/workflow.md` | AI 开发流程规范 |
| `docs/neeko-development-spec.md` | 全栈 Feature-Based / Domain-Driven 架构规范 |

## 键盘快捷键

| 快捷键                  | 功能                   |
| ----------------------- | ---------------------- |
| `Ctrl+1` ~ `Ctrl+9`     | 跳转到第 N 个项目      |
| `Ctrl+Q`                | 循环切换项目           |
| `Ctrl+Alt+T` / `Ctrl+W` | 打开/关闭副终端        |
| `Ctrl+O`                | 在 IDE 中打开项目      |
| `Ctrl+N`                | 循环切换 Worktree 终端 |
| `Ctrl+R`                | 手动刷新终端           |
| `Escape`                | 关闭设置面板           |

## Testing and QA

### 测试框架

- **前端**：Vitest + @testing-library/react + jsdom
- **后端**：Rust 内置 `#[test]` + `tempfile`（临时目录）

### 测试目录结构

```
src/
├── testing/                      # 全局测试配置
│   ├── setup.ts                  # vitest 全局 setup
│   └── factories.ts              # 测试工厂函数
├── features/.../__tests__/       # 功能域测试
├── shared/hooks/__tests__/       # Hook 测试
└── shared/utils/__tests__/       # 工具函数测试
src-tauri/tests/
├── unit.rs                       # 集成测试入口
└── unit/                         # 单元测试模块
```

### 测试优先级

| Tier | 目标 | 方法 |
| ---- | ---- | ---- |
| 1 | 纯函数（`getFileIcon`、`buildTree`、`parse_unified_diff`） | 直接调用，断言返回值 |
| 2 | Hooks | `renderHook` + `act` |
| 3 | Rust 管理器（`AgentManager`、`ProjectManager`） | `#[test]` 函数 |
| 4 | 组件（需要 mock `invoke`） | `@testing-library/react` |

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
4. 不要主动提交代码

```bash
python3 ./.trellis/scripts/add_session.py --title "<title>" --commit "<hash>"
```

## Quick Change Playbooks

### 新增 Tauri 命令

1. 在对应域文件添加命令函数
2. 保持返回类型 `Result<T, AppError>`
3. 将命令加入 `neeko_invoke_handler!`（位于 `src-tauri/src/lib.rs`）
4. 补充必要测试并执行回归命令

### 修改前端容器逻辑

1. 优先修改 `useAppShell` 或相关 domain hook
2. 避免把业务逻辑回填到 `App.tsx`
3. 更新类型定义并跑 `pnpm type-check`

### 变更构建或权限配置

1. 同步检查 `package.json`、`vite.config.ts`、`tauri.conf.json`、`capabilities/default.json`
2. 验证 `pnpm tauri dev` 与 `pnpm tauri build`

## 已知问题

- SSH 凭据重连自动填充可能有边界情况
- SSH 路径自动补全下拉可能有 z-index 问题
- 自定义 IDE 的 icon 解析不支持

## 相关文档

- `docs/neeko-development-spec.md` — 全栈 Feature-Based / Domain-Driven 架构规范
- `docs/ARCHITECTURE.md` — 架构总览
- `docs/project-backend-struct-spec.md` — 后端结构规范
- `docs/project-frontend-struct-spec.md` — 前端结构规范
- `docs/REQUIREMENTS.md` — 完整需求文档
- `docs/skill-management-design.md` — Skill 系统设计
- `docs/agents/issue-tracker.md` — Issue 跟踪
- `docs/agents/triage-labels.md` — Triage 标签规则
- `docs/agents/domain.md` — 单语境上下文说明

---

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
