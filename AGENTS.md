# Neeko — Repository Guidelines

> AI 编程助手项目上下文与开发规范（跨栈部分）。
>
> **分层加载模型** —— 本文件只放「改任何目录都成立」的内容（跨栈契约、通用原则、红线索引）。
> 单侧专属规则按代码物理边界拆分：
>
> - `src-tauri/AGENTS.md` —— Rust 后端红线 1,2,3,6,7,8,9,10,11,13,15 + 命令层/并发/导入防火墙
> - `src/AGENTS.md` —— React 前端红线 12 + 模块导入防火墙 + React 性能 + 状态管理
>
> **硬指令：动手改 `src-tauri/**` 或 `src/**` 前，必须先 Read 对应子目录的 `AGENTS.md`。**
> 不要依赖工具自动注入 —— 各工具行为不同：opencode / Claude Code 只在 Read 工具打开该子树
> 文件时注入（`@` 提及、IDE 打开均不触发）；Codex 只拼接「仓库根 → 当前工作目录」路径上的
> 文件，从仓库根启动的会话**不会**加载嵌套文件。漏读 = 该侧 11 / 1 条红线整体失效，等同盲改。
>
> 机制细节与事故复盘在 `.trellis/spec/<层>/<主题>.md`（按需 `trellis-before-dev` 载入）与 `docs/`。
> **每条红线全文只在一个 AGENTS.md 中出现**（`.trellis/spec/` 是机制详解层，另当别论），
> 本文件的索引表负责指向它（`check_agents_md_size.py` 校验体积、落点唯一与台账一致）。

## 项目概览

**Neeko** 是基于 Tauri 2.0 + React 18 的桌面应用，统一管理多项目 AI Agent 会话，支持本地 / WSL /
SSH 远程三种项目类型。核心目标：把终端会话、Git 操作、文件变更、IDE 启动与 Skill 管理聚合到同一窗口，
并保持会话可恢复。

- **版本 / 标识符**：见 `package.json` 与 `src-tauri/tauri.conf.json`（**不在此处复述**，历史上曾滞后三个版本）
- **许可证**：Apache 2.0 · **Rust edition**：2021 · **Node**：>=24 · **包管理器**：pnpm（版本取 `package.json` 的 `packageManager` 字段）
- **前端端口**：1420（`tauri.conf.json` 的 `build.devUrl`）

## 顶层目录

```
src/                 React 前端（Feature-Based）→ 规则见 src/AGENTS.md
src-tauri/           Rust 后端（Domain-Driven）→ 规则见 src-tauri/AGENTS.md
  src/core/          exec facade / runtime / project 环境抽象
  src/common/        error、logger、executor、git、utils
  src/platform/      平台适配器集中层（红线 10）
docs/                架构、需求与设计文档
.trellis/            spec 知识库、任务、会话日志（Trellis 管理）
```

子目录清单一律以 `ls` / Glob 为准，本文档不维护树状图。详版：`docs/ARCHITECTURE.md`、
`.trellis/spec/{backend,frontend}/directory-structure.md`。

## Development Commands

```bash
pnpm install                 pnpm tauri dev            pnpm tauri build
pnpm lint          # Rust fmt + clippy(-D warnings) + 全部 .trellis/scripts/check_*.py 护栏
pnpm lint:fe       # ESLint + tsc + vitest typecheck
pnpm type-check    # npx tsc --noEmit
pnpm test / test:run / test:coverage
cargo test --manifest-path src-tauri/Cargo.toml
```

最小回归集：`pnpm lint` + `pnpm type-check` + `pnpm test:run` + `cargo test`。

## 架构基本原则（强制）

> 优先级高于具体实现细节。前端专属细则（导入防火墙、状态管理）在 `src/AGENTS.md`。

**高内聚低耦合** —— ① 单一职责：一个单元只有一个改变理由，承担多职责即拆分。② 高内聚：同模块代码必须
紧密相关。③ 低耦合：模块间依赖必须通过明确接口（API wrapper / `pub use` re-export / props/context），
禁止跨域直接引用内部实现。④ 依赖倒置：高层不依赖低层实现细节，两者都依赖抽象。

**开闭原则** —— 新增功能通过添加代码（新 variant / 新 strategy / 新组件）实现，而非修改已有代码；
策略集已知且固定时用 `Enum + match` 代替 `Box<dyn Trait>`（编译期 dispatch，新 variant 强制处理）。

**DRY / KISS / YAGNI** —— 重复逻辑 3 次以上必须抽象；选最简方案不过度设计；当前不需要的不实现、
不预留「将来可能用到」的抽象层。

## TDD 开发模式（强制）

Red（先写失败测试）→ Green（最少代码让测试通过）→ Refactor（保持通过下重构）。

- **新功能**：定义接口/types → 写测试（正常路径 + 边界 + 错误）→ 确认 Red → 实现 → 重构 → 跨模块补集成测试。
- **Bug 修复**：先写复现测试并确认 Red → 修复 → 确认通过 → 检查同类问题并扩展覆盖。
- **覆盖率**：纯函数 100%（直接断言）· Rust manager 核心路径（`#[test]`）· Hooks 关键行为（`renderHook`+`act`）· 组件关键交互（`@testing-library/react`）。
- **硬约束**：没有测试的新代码不允许合入；改已有代码前先确认已有测试通过；测试独立（不依赖顺序与外部状态）、快速（单个 <100ms，全量 <30s）。

## AI 代码审查红线 (Review Gates)

> 经代码库验证，违反即为 Block 级。**跨域红线（4、5、14）全文在本文件**，其余全文在对应嵌套文件。
> 编号是稳定标识符，spec/docs 引用编号而非正文。

| # | 红线 | 全文位置 |
| --- | --- | --- |
| 1 | 统一命令执行接口（Local/WSL/SSH） | `src-tauri/AGENTS.md` |
| 2 | 跨平台 shell 选择（`cmd /c` vs `sh -c`） | `src-tauri/AGENTS.md` |
| 3 | 阻塞 I/O 隔离（`spawn_blocking`） | `src-tauri/AGENTS.md` |
| 4 | **IPC 大文本边界** | 本文件 ↓ |
| 5 | **Event 名常量化** | 本文件 ↓ |
| 6 | Command 层保持极薄 | `src-tauri/AGENTS.md` |
| 7 | `if let` 嵌套不超过 3 层 | `src-tauri/AGENTS.md` |
| 8 | 路径安全校验（`canonicalize` + capabilities 白名单） | `src-tauri/AGENTS.md` |
| 9 | `mod.rs` 保持极薄 | `src-tauri/AGENTS.md` |
| 10 | 平台代码规范化（Platform Adapter） | `src-tauri/AGENTS.md` |
| 11 | 换行边界（Line-Ending Boundary） | `src-tauri/AGENTS.md` |
| 12 | 路径身份唯一化（`FileRef`） | `src/AGENTS.md` |
| 13 | 测试夹具路径平台无关 | `src-tauri/AGENTS.md` |
| 14 | **LSP 能力声明与实现一致** | 本文件 ↓ |
| 15 | 语言差异必须落在插件数据 | `src-tauri/AGENTS.md` |

### 4. IPC 大文本边界（跨栈：Rust 返回 ↔ 前端消费）

单次 Command 返回的 JSON 不超过 **2MB**。Diff 视图、PTY 缓冲区、大目录列表等长度不确定的载荷，
必须走 Tauri 二进制流（`Response::new(Vec<u8>)` + 前端 `invoke<ArrayBuffer>`）或前端虚拟滚动/分页
按需请求，禁止整体 JSON 序列化返回。膨胀机制与终端 5.2GB 事故：
`.trellis/spec/backend/command-guidelines.md`、`concurrency-guidelines.md`。

### 5. Event 名常量化（跨栈：Rust ↔ 前端）

Tauri Event 字符串（如 `terminal-output-{id}`、`git-status-diff`）禁止双端各自硬编码。Rust 端定义为
常量，前端通过统一模块引用。改一端必须同步另一端；新增事件名只允许来自单一常量源。

### 14. LSP 能力声明必须与实现一致（跨栈：Rust 声明 ↔ TS 消费）

向语言服务器声明的每一项客户端能力都是**行为契约** —— 服务器据此切换通道，声明了却没人实现 =
静默功能缺失；**该声明却没声明同样违约**（rust-analyzer 会整条丢弃 flyimport 候选）。

改 `build_client_capabilities()` / `plugin.with_extended_client_capabilities()` 前必须回答
「哪段代码消费它」，并在**同一 diff 内**给出实现或删掉声明。消费者统一在
`src/features/lsp/hooks/lspCompletionResolve.ts`。护栏测试
`java_plugin_advertises_only_implemented_extended_capabilities`；jdtls / rust-analyzer / gopls 的
三条实测策略见 `.trellis/spec/backend/lsp-domain.md`「能力声明必须与实现一致」。

**禁止**因为某次事故就把能力按语言切成开关 —— 那会违反红线 15。

## 业界最佳实践（React / Rust 通用底线）

> 供 `neeko-check` 审核时对齐。业界通用最佳实践独立成文件、按需扩展，索引见
> [`docs/best-practices/index.md`](docs/best-practices/index.md)（含 React / Rust / 通用工程实践）。
> 与项目特有规范（`.trellis/spec/`）互补，涉及项目特有时直接链接到对应 spec 文件。

## Important Files

| 文件 | 作用 |
| --- | --- |
| `src-tauri/src/lib.rs` | 模块聚合与 `neeko_invoke_handler!`（命令注册单一事实源） |
| `src-tauri/src/app.rs` | Tauri 启动与命令注册入口 |
| `src-tauri/src/app_state.rs` | `AppStateWrapper` 组装中心 |
| `src-tauri/src/common/error.rs` | `AppError` 定义与错误转换 |
| `src/app/App.tsx` · `src/app/hooks/useAppShell.ts` | 前端组合根组件 · 主协调 hook |
| `src/shared/store/` · `src/shared/types/` | zustand 全局状态 · TypeScript 类型 |
| `src/shared/utils/fileRef.ts` | 路径身份唯一化入口（红线 12） |
| `package.json` · `src-tauri/Cargo.toml` · `src-tauri/tauri.conf.json` | 脚本与版本 · Rust 依赖与目标 · Tauri 构建与窗口 |
| `.trellis/workflow.md` · `docs/neeko-development-spec.md` | AI 开发流程 · 全栈架构规范 |

## 已知问题

- SSH 凭据重连自动填充可能有边界情况；SSH 路径自动补全下拉可能有 z-index 问题
- 自定义 IDE 的 icon 解析不支持
- **改了 `node_modules` / `patches/*.patch` 后 Vite 预打包不失效会继续跑旧代码**：
  完整流程与必须 `rm -rf node_modules/.vite` 的原因见
  `.trellis/spec/frontend/quality-guidelines.md`「依赖补丁与 Vite 预打包缓存」

## AI Assistant Workflow Notes

**开发前**：`python3 ./.trellis/scripts/get_context.py` → 读相关 spec index → 创建/选择任务目录 →
`task.py init-context` + `task.py add-context` → `task.py start` 激活上下文。

**收尾**：跑质量命令确认通过 → 同步必要 spec 文档 → `python3 ./.trellis/scripts/add_session.py
--title "<title>" --commit "<hash>"` → **不要主动提交代码**。

## Quick Change Playbooks

- **新增 Tauri 命令**：域文件加函数（返回 `Result<T, AppError>`）→ `mod.rs` 聚合 → 命令路径加入
  `neeko_invoke_handler!` → 补测试并跑回归
- **改前端容器逻辑**：优先改 `useAppShell` 或 domain hook，不把业务逻辑回填到 `App.tsx`；更新类型并跑 `pnpm type-check`
- **改构建或权限配置**：同步检查 `package.json`、`vite.config.ts`、`tauri.conf.json`、`capabilities/default.json`，验证 `pnpm tauri dev` 与 `build`

## 相关文档

- `docs/ARCHITECTURE.md` 架构总览 · `docs/neeko-development-spec.md` 全栈架构规范
- `docs/project-backend-struct-spec.md` / `docs/project-frontend-struct-spec.md` 前后端结构规范
- `docs/REQUIREMENTS.md` 需求 · `docs/skill-management-design.md` Skill 系统
- `docs/keyboard-shortcuts.md` 快捷键表（面向用户，非 Agent 指令）
- `docs/best-practices/index.md` 业界通用底线（React / Rust / 通用工程），供 `neeko-check` 对齐
- `docs/agents/issue-tracker.md` Issue 跟踪 · `docs/agents/triage-labels.md` Triage 标签 · `docs/agents/domain.md` 单语境上下文
- `.trellis/spec/` 分层编码规范（backend / frontend / unit-test / security / guides）

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
