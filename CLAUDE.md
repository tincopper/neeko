# Neeko — AGENTS.md

> AI 编程助手项目上下文与开发规范

## 项目概览

**Neeko** 是一个基于 Rust + Tauri 2.0 的跨平台桌面应用，统一管理多个 AI CLI Agent 工具。支持三种项目类型：本地、WSL（Windows）、SSH 远程。每个项目绑定独立 PTY 终端会话，支持 Git 分支管理、Worktree 管理、文件 Diff 查看、副终端面板和 IDE 一键启动。

- **版本**: 1.0.3
- **标识符**: `com.neeko.app`
- **许可证**: Apache 2.0
- **前端**: React 18 + TypeScript + Vite
- **后端**: Rust + Tauri 2.0 + tokio

## 常用命令

```bash
# 安装依赖
pnpm install

# 开发模式
pnpm tauri dev

# 构建发布版本
pnpm tauri build

# 前端类型检查
npx tsc --noEmit

# Rust 编译检查
cargo check --manifest-path src-tauri/Cargo.toml

# 前端测试
pnpm test

# 前端测试（watch 模式）
pnpm test:watch

# Rust 测试
cargo test --manifest-path src-tauri/Cargo.toml
```

## 目录结构

```
neeko/
├── src/                              # 前端 (React + TypeScript)
│   ├── App.tsx                       # 组合层：hook 调用 + JSX 编排
│   ├── main.tsx                      # 入口点
│   ├── types.ts                      # 全局 TypeScript 类型定义（单一源）
│   ├── styles.css                    # 全局样式（One Dark Pro 主题 + CSS 变量）
│   ├── vite-env.d.ts                 # Vite 模块声明（*.png, *.svg）
│   ├── assets/                       # 静态资源
│   │   ├── agents/                   # Agent logo（PNG/SVG）
│   │   ├── distros/                  # WSL 发行版 logo（SVG）
│   │   ├── ides/                     # IDE logo（SVG/PNG）
│   │   ├── linux.svg                 # WSL 通用图标
│   │   ├── server.svg                # SSH 图标
│   │   ├── folder.svg                # 文件夹图标
│   │   └── cli.svg                   # 自定义 Agent 图标
│   ├── components/
│   │   ├── terminal/                 # 终端组件
│   │   │   ├── TerminalView.tsx      # 本地终端（xterm.js + PTY 缓存）
│   │   │   ├── SideTerminalView.tsx  # 副终端
│   │   │   ├── WorktreeTerminalView.tsx  # Worktree 终端
│   │   │   ├── WSLTerminalView.tsx   # WSL 终端
│   │   │   ├── RemoteTerminalView.tsx    # SSH 远程终端
│   │   │   └── index.ts              # barrel export
│   │   ├── connections/              # WSL + SSH 连接管理
│   │   │   ├── WSLDialog.tsx         # WSL 发行版/路径选择
│   │   │   ├── RemoteDialog.tsx      # SSH 服务器配置/路径选择
│   │   │   ├── RemoteAuthDialog.tsx  # SSH 重新认证对话框
│   │   │   └── RemoteItems.tsx       # WSLItem/RemoteItem 侧边栏组件
│   │   ├── project/                  # 本地项目管理
│   │   │   ├── ProjectSidebar.tsx    # 左侧边栏（可拖拽宽度）
│   │   │   ├── ProjectItem.tsx       # 单个本地项目卡片
│   │   │   ├── FileTree.tsx          # 变更文件树（紧凑包压缩）
│   │   │   ├── GitDialog.tsx         # 新建分支/Worktree 对话框
│   │   │   └── AddProjectModal.tsx   # 添加项目确认（含 Agent/IDE 选择）
│   │   ├── layout/                   # 窗口布局
│   │   │   ├── TitleBar.tsx          # 自定义标题栏（无系统边框）
│   │   │   ├── WindowControls.tsx    # 最小化/最大化/关闭按钮
│   │   │   ├── AgentSelector.tsx     # Agent 下拉选择器
│   │   │   └── AgentIcon.tsx         # Agent logo 渲染器
│   │   ├── MainContent.tsx           # 跨域编排组件
│   │   ├── DiffView.tsx              # Git diff 视图（统一/并排模式）
│   │   └── SettingsPanel.tsx         # 设置面板（Editor/Terminal/Agents/IDE/Git）
│   ├── hooks/                        # 自定义 React hooks
│   │   ├── useAppConfig.ts           # 应用配置（加载/保存/同步 CSS 变量）
│   │   ├── useLocalProjects.ts       # 本地项目状态管理
│   │   ├── useWslProjects.ts         # WSL 项目状态管理
│   │   ├── useRemoteProjects.ts      # SSH 项目状态管理 + 认证
│   │   ├── useWslActions.ts          # WSL 操作（diff/branch/worktree/IDE）
│   │   ├── useRemoteActions.ts       # SSH 操作（diff/branch/worktree/IDE）
│   │   ├── useWorktreeState.ts       # Worktree 状态管理
│   │   ├── useSideTerminalResize.ts  # 副终端拖拽调整大小
│   │   ├── useToast.ts               # Toast 通知
│   │   ├── useKeyboardShortcuts.ts   # 键盘快捷键
│   │   ├── useCrossDomainRefs.ts     # 跨域 setter refs
│   │   └── useSessionBootstrap.ts    # 应用启动引导
│   └── utils/
│       ├── terminal.ts               # 终端工具（默认字体、字体栈构建）
│       ├── agents.ts                 # Agent icon 解析
│       ├── distros.ts                # WSL 发行版 icon 解析（模糊匹配）
│       ├── idePresets.ts             # IDE 预设 + icon 解析
│       ├── platform.ts               # 平台检测（IS_WINDOWS）
│       └── fileIcons.ts              # 文件类型图标
├── src-tauri/                        # 后端 (Rust)
│   ├── src/
│   │   ├── main.rs                   # Tauri 应用入口
│   │   ├── lib.rs                    # Tauri 命令注册 + AppStateWrapper
│   │   ├── state.rs                  # 核心数据结构
│   │   ├── project.rs                # 项目管理（ProjectManager）
│   │   ├── terminal.rs               # 本地/WSL 终端管理
│   │   ├── remote.rs                 # SSH 远程终端管理（russh）
│   │   ├── agent.rs                  # Agent 管理（7 个预置 Agent）
│   │   ├── git.rs                    # Git 操作（git2-rs）
│   │   ├── storage.rs                # 持久化管理
│   │   ├── watcher.rs                # 文件监听
│   │   └── logger.rs                 # 文件日志
│   ├── capabilities/default.json     # Tauri 权限配置
│   ├── tauri.conf.json               # Tauri 主配置
│   ├── tauri.{windows,macos,linux}.conf.json  # 平台配置
│   └── Cargo.toml                    # Rust 依赖
├── docs/                             # 设计文档
├── REQUIREMENTS.md                   # 完整需求文档
├── README.md / README_CN.md          # 项目 README
└── AGENTS.md                         # 本文件
```

## 开发规范

### 前端 (React + TypeScript)

#### 类型管理

- 所有共享接口定义在 `src/types.ts`（单一源）
- 组件内不重复定义已有类型
- 组件内部类型用 `interface` 但不导出

#### Hook 设计原则

1. **按领域划分**：`useLocalProjects`、`useWslProjects`、`useRemoteProjects`
2. **返回稳定引用**：所有返回函数用 `useCallback` 包装
3. **跨域协调在 App.tsx**：hook 管理自己的状态，跨域逻辑在 App 层组合
4. **Ref 同步集中**：所有 refs 在 App.tsx 的单个 `useEffect` 中同步

#### React 性能优化

| 模式          | 规则                                               |
| ------------- | -------------------------------------------------- |
| `React.memo`  | 列表项组件、大型布局组件、复用组件                 |
| `useMemo`     | 昂贵计算（`buildTree`、字体列表、分支过滤）        |
| `useCallback` | 跨组件回调、hooks 返回的函数                       |
| 内联对象      | 避免 JSX 中 `style={{...}}` 常量对象，提取到模块级 |
| 条件渲染      | 用三元而非 `&&`（避免 falsy 值渲染）               |
| Ref 模式      | 频繁变化的值用 ref 跟踪，在 effect 中同步          |

#### Barrel Export

每个子目录有 `index.ts` barrel export：

```typescript
import { TerminalView } from './components/terminal'
import { TitleBar, AgentIcon } from './components/layout'
```

#### 共享工具

- `utils/terminal.ts`：`DEFAULT_FONT_FAMILY`、`buildFontFamily()`
- `utils/agents.ts`：`getAgentIconSrc(icon)`
- `utils/distros.ts`：`getDistroIcon(name)`（模糊匹配）
- `utils/platform.ts`：`IS_WINDOWS`
- **不在多个文件中重复常量定义**

### 后端 (Rust)

#### 模块职责

| 模块          | 职责                                                             |
| ------------- | ---------------------------------------------------------------- |
| `lib.rs`      | Tauri 命令注册、AppStateWrapper 初始化                           |
| `state.rs`    | 核心数据结构（Project, GitInfo, TerminalSession, AuthMethod 等） |
| `project.rs`  | ProjectManager：项目 CRUD、Git 信息刷新                          |
| `terminal.rs` | TerminalManager：本地/WSL PTY 终端生命周期                       |
| `remote.rs`   | RemoteTerminalManager：SSH 远程终端（russh）                     |
| `agent.rs`    | AgentManager：7 个预置 Agent + 自定义 Agent                      |
| `git.rs`      | Git 操作封装（git2-rs）                                          |
| `storage.rs`  | 持久化：sessions.json + config.json，旧格式迁移                  |
| `watcher.rs`  | 文件监听（notify + 800ms 防抖 + 10s 轮询）                       |
| `logger.rs`   | 自定义 `log::Log`，写入 `~/.neeko/neeko.log`                     |

#### 错误处理

- 使用 `anyhow::Result` 作为 Tauri 命令返回类型
- 错误消息通过 `Result<T, String>` 传递给前端

#### 平台门控

- WSL 命令使用 `cfg!(target_os = "windows")` 门控
- Windows 使用 `CREATE_NO_WINDOW` (0x08000000) 避免控制台闪烁

### 测试 (TDD)

**本项目采用 TDD 驱动开发。所有新增需求或改动必须先写测试再写实现。**

#### 测试框架

- **前端**：Vitest + @testing-library/react + jsdom
- **后端**：Rust 内置 `#[test]` + `tempfile`（临时目录）

#### 测试目录结构

```
src/
├── testing/                      # 全局测试配置
│   ├── setup.ts                  # vitest 全局 setup
│   └── factories.ts              # 测试工厂函数
├── components/
│   └── __tests__/                # 组件测试
│       ├── DiffView.test.tsx
│       ├── FileTree.test.tsx
│       └── SettingsPanel.test.tsx
├── hooks/
│   └── __tests__/               # Hook 测试
│       ├── useAppConfig.test.ts
│       ├── useLocalProjects.test.ts
│       └── useWorktreeState.test.ts
└── utils/
    └── __tests__/               # 工具函数测试
        ├── terminalInput.test.ts
        ├── fileIcons.test.ts
        ├── distros.test.ts
        ├── agents.test.ts
        ├── terminal.test.ts
        ├── idePresets.test.ts
        └── platform.test.ts
src-tauri/src/
├── git.rs    (#[cfg(test)] 模块)
├── agent.rs  (#[cfg(test)] 模块)
└── ...
```

#### 测试优先级

| Tier | 目标                                                       | 方法                     |
| ---- | ---------------------------------------------------------- | ------------------------ |
| 1    | 纯函数（`getFileIcon`、`buildTree`、`parse_unified_diff`） | 直接调用，断言返回值     |
| 2    | Hooks（`useWorktreeState`）                                | `renderHook` + `act`     |
| 3    | Rust 管理器（`AgentManager`、`ProjectManager`）            | `#[test]` 函数           |
| 4    | 组件（需要 mock `invoke`）                                 | `@testing-library/react` |

#### TDD 流程

1. **先写测试**：定义输入/输出，编写失败的测试用例
2. **红灯**：运行 `pnpm test` / `cargo test`，确认测试失败
3. **绿灯**：编写最小实现使测试通过
4. **重构**：优化代码，保持测试通过
5. **提交**：测试 + 实现一起提交

#### 测试规范

- 纯函数测试不 mock 任何依赖
- Hook 测试使用 `renderHook`，不渲染组件
- Rust 测试使用 `#[cfg(test)]` 模块，避免污染生产代码
- 测试命名：`should_<行为>_when_<条件>`
- 每个测试用例独立，不依赖执行顺序

## 架构要点

### 终端缓存

全局 Map 缓存，key 格式：

- 本地：`{projectId}` / `{projectId}:side` / `{projectId}:wt:{worktreePath}`
- WSL：`wsl:{distro}:{projectId}` / `wsl:{distro}:{projectId}:side`
- SSH：`remote:{entryId}:{projectId}` / `remote:{entryId}:{projectId}:side`

PTY 会话在组件卸载时保持存活（DOM detach/reattach）。

### SSH IO 架构

`channel.make_writer()` 分离读写，`tokio::select!` 三路并发：

1. Input: `input_rx` → `channel.make_writer()`
2. Resize: `resize_rx` → `channel.window_change()`
3. Output: `channel.wait()` → `emit terminal-output-{id}`

### Agent 自动启动延迟

- 本地：即时 | WSL：500ms | SSH：800ms

### 持久化

- `~/.neeko/sessions.json`：项目、WSL、SSH、宽度、Worktree 状态
- `~/.neeko/config.json`：字体、Diff 模式、Shell、IDE/Agent 覆盖

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

## 预置 Agent

opencode, claude-code, gemini, codex, qoder, codebuddy

## 预置 IDE

VS Code, Cursor, Zed, IntelliJ IDEA, GoLand, RustRover, PyCharm

## 已知问题

- SSH 凭据重连自动填充可能有边界情况
- SSH 路径自动补全下拉可能有 z-index 问题
- 自定义 IDE 的 icon 解析不支持

## 相关文档

- `docs/neeko-development-spec.md` — 全栈 Feature-Based / Domain-Driven 架构规范（含 ESLint 约束）
- `docs/REQUIREMENTS.md` — 完整需求文档
- `docs/SESSION_CONTEXT.md` — 开发历史与架构发现
- `docs/skill-management-design.md` — Skill 系统设计（未实现）

## Agent skills

### Issue tracker

Issues are tracked on GitHub. See `docs/agents/issue-tracker.md`.

### Triage labels

The five canonical triage roles use their default label names. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context — `CONTEXT.md` at the repo root covers the whole project. See `docs/agents/domain.md`.
