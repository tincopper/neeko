# 参与 Neeko 贡献指南

感谢你对 **Neeko** 的关注与贡献 —— 一个基于 Tauri 2.0 + React 18 的桌面应用，用于统一管理多项目 AI Agent 会话（本地 / WSL / SSH 三端）。

本文档说明如何搭建开发环境、遵循的代码规范、自动执行的质量门，以及如何让你的改动被合并。

> English version: [CONTRIBUTING.md](./CONTRIBUTING.md)

---

## 目录

- [开发环境](#开发环境)
- [快速开始](#快速开始)
- [常用命令](#常用命令)
- [项目结构](#项目结构)
- [代码规范](#代码规范)
- [测试驱动开发（TDD）](#测试驱动开发tdd)
- [提交信息规范](#提交信息规范)
- [质量门（Quality Gates）](#质量门quality-gates)
- [测试要求](#测试要求)
- [分支与 Pull Request](#分支与-pull-request)
- [文档](#文档)
- [发布流程](#发布流程)

---

## 开发环境

| 工具 | 版本 |
| --- | --- |
| Node.js | 18+ |
| pnpm | `9.12.2` |
| Rust | edition 2021（stable） |
| Tauri | 2.0 |

请先按平台安装 Tauri 的系统依赖：

- **macOS**：Xcode Command Line Tools（`xcode-select --install`）
- **Linux**：WebKitGTK / GTK / AppIndicator / librsvg / patchelf
- **Windows**：Microsoft C++ Build Tools + WebView2

详见 [Tauri 前置依赖指南](https://v2.tauri.app/start/prerequisites/)。

## 快速开始

```bash
pnpm install          # 安装前端依赖
pnpm tauri dev        # 启动开发模式（前端端口 1420）
```

## 常用命令

| 命令 | 用途 |
| --- | --- |
| `pnpm tauri dev` | 运行开发模式 |
| `pnpm tauri build` | 构建发布版本 |
| `pnpm lint` | Rust `cargo fmt --check` + `cargo clippy` |
| `pnpm lint:fe` | 前端 ESLint + `tsc --noEmit` + vitest typecheck |
| `pnpm lint:all` | Rust 与前端全部 lint |
| `pnpm type-check` | 仅 TypeScript 类型检查 |
| `pnpm test` | Vitest 监听模式 |
| `pnpm test:run` | 运行一次前端测试 |
| `pnpm test:coverage` | 带覆盖率运行前端测试 |
| `cargo test --manifest-path src-tauri/Cargo.toml` | 运行 Rust 测试 |
| `pnpm release <version>` | 升级版本、生成 changelog、打 tag（见[发布流程](#发布流程)） |

## 项目结构

### 前端 —— Feature-Based 架构

```
src/
├── app/          # 应用入口与组合层（App.tsx、useAppShell）
├── features/     # 功能域，各自含 components/ hooks/ store/
├── shared/       # 跨域共享：components、contexts、hooks、store、types、utils
├── layout/       # 窗口布局框架
├── ui/           # 通用 UI 组件
└── styles/       # 全局样式
```

### 后端 —— Domain-Driven 模块化架构

```
src-tauri/src/
├── main.rs / lib.rs / app.rs / app_state.rs
├── common/       # 共享基础设施（error、logger、runtime）
├── <domain>/     # 例如 agent、project、session、terminal、connection、git、search
│   ├── commands.rs   # 极薄的 Tauri 命令层
│   ├── services.rs   # 业务逻辑
│   └── mod.rs        # 仅 mod 声明与 re-export
└── ...
```

## 代码规范

### 架构原则

1. **高内聚、低耦合** —— 每个模块只负责一项清晰职责；模块间通过显式接口
   （props / context / API wrapper / `pub use` re-export）通信。
2. **依赖倒置（DIP）** —— 高层模块依赖抽象，而非具体实现。
3. **开闭原则（OCP）** —— 通过新增代码（新 variant、新策略、新组件）扩展，
   而非修改既有逻辑；变体集合已知且固定时用 `Enum + match` 而非 `Box<dyn Trait>`。
4. **DRY / KISS / YAGNI** —— 重复逻辑（3 次以上）抽象复用；优先最简单方案；
   不为"将来可能用到"而过度设计。

### 模块导入/导出防火墙

- **禁止根级 barrel**（如 `@/components/index.ts`）。
- 跨 feature 使用 **store** 一律直导具体文件（`@/features/file/store`），
  禁止经 feature `index.ts` re-export。
- **类型**直接导入（`export type` 编译期擦除）。
- feature 的 `index.ts` **仅为门面** —— 只 re-export 公开组件与 hooks，
  禁止纳入 store 或内部工具函数。
- 同 feature 内部模块之间直接导入具体文件，不得经本目录 `index.ts` 自环引用。

### 状态管理

- 状态就近存放（`useState` → feature store → `shared/store`）。
- 不存储可派生状态，用 `useMemo` 计算。
- 单向数据流：数据向下流动、事件向上传递；子组件不得直接修改父组件状态。

### Rust 命令层

- 命令使用 `#[tauri::command]`，返回 `Result<T, AppError>`。
- 命令层保持**极薄**：只做参数接收 + 校验，再调度 service/manager。
- 每个新命令都要注册进 `src-tauri/src/lib.rs` 的 `neeko_invoke_handler!`。
- 命令执行统一走 `crate::core::exec` / `crate::common::executor`
  （Local/WSL/SSH 统一接口），禁止使用已弃用的 `local::exec` 辅助函数。
- 阻塞 I/O（`std::fs`、`std::process`、PTY）必须包裹进
  `tokio::task::spawn_blocking`。
- `mod.rs` 保持极薄：只允许 `mod` 声明与 `pub use` re-export。

## 测试驱动开发（TDD）

所有新功能与 Bug 修复都必须遵循 **红 → 绿 → 重构** 循环：

1. **红（Red）** —— 先写失败的测试，精确定义预期行为；确认失败原因符合预期。
2. **绿（Green）** —— 写最少代码让测试通过。
3. **重构（Refactor）** —— 在测试保护下消除重复、提升可读性。

**Bug 修复**从复现该 Bug 的回归测试开始，再实施修复。

> 没有测试的新代码不允许合入。修改已有代码前，先确认已有测试通过。

## 提交信息规范

遵循 **Conventional Commits 1.0.0**，由 commitlint 强制校验：

```text
<type>(<scope>): <subject>

<body>

<footer>
```

### 允许的类型

`feat`、`fix`、`refactor`、`chore`、`docs`、`style`、`perf`、`test`、
`build`、`ci`、`revert`、`wip`

- **feat** —— 新功能
- **fix** —— Bug 修复
- **refactor** —— 代码重构（非修 Bug、非新功能）
- **chore** —— 维护（依赖、配置等）
- **docs** —— 仅文档
- **style** —— 格式调整（无逻辑变更）
- **perf** —— 性能优化
- **test** —— 新增/修改测试
- **build** / **ci** —— 构建系统 / CI 变更
- **revert** —— 回滚提交
- **wip** —— 进行中（临时）

### 规则

- **Scope** 可选但鼓励（如 `feat(search): ...`）。
- **Subject** 简短（≤ 50 字符）、祈使句、结尾无标点，中英文均可。
- 复杂改动使用 **Body**：说明"为什么改"和"怎么改"。
- 破坏性变更在 type 后加 `!`，并以 `BREAKING CHANGE:` 页脚标注。
- 关联 Issue 写在页脚（如 `Closes #123`）。

### 示例

```text
feat(search): add find-in-files content search panel

Add a full-text search panel (Ctrl+Shift+F) that works across local,
WSL and SSH projects.
```

```text
fix(file): refresh expanded dir caches on file move/delete
```

保持提交**原子化**：把不相干的改动拆分为多个独立提交。

## 质量门（Quality Gates）

[lefthook](https://github.com/evilmartians/lefthook) 会在提交时自动执行。
Hooks 通过 `pnpm prepare`（或 `pnpm lefthook install`）安装。

| Hook | 触发条件 | 执行内容 |
| --- | --- | --- |
| `pre-commit` | 改动 `src/**/*.{ts,tsx,js,jsx}` | `pnpm lint:fe` |
| `pre-commit` | 改动 `src-tauri/**/*.rs` | `pnpm lint` |
| `commit-msg` | 每次提交 | `pnpm commitlint` |

所有质量门通过前提交会被拦截。开 PR 前请在本地跑一遍最小回归集：

```bash
pnpm lint:all
pnpm test:run
cargo test --manifest-path src-tauri/Cargo.toml
```

## 测试要求

| 层级 | 要求 | 方法 |
| --- | --- | --- |
| 纯函数 / 工具类 | 100% 覆盖 | 直接调用 + 断言返回值 |
| Manager 逻辑（Rust） | 核心路径覆盖 | `#[test]` 函数 |
| 自定义 Hooks（TS） | 关键行为 | `renderHook` + `act` |
| 组件 | 关键交互 | `@testing-library/react` |

测试必须独立、快速（单个 < 100ms），且不依赖外部状态。涉及文件系统的 Rust
测试使用 `tempfile`，**严禁**写入真实的 `~/.neeko` 配置。

## 分支与 Pull Request

1. 从 `main` 创建分支（如 `feat/<short-name>` 或 `fix/<short-name>`）。
2. 按 TDD 实现，保持提交原子化且符合 Conventional 规范。
3. 本地跑通完整质量门（见[质量门](#质量门quality-gates)）。
4. 向 `main` 发起 PR，清晰描述改动内容与原因。
5. 保持 PR 聚焦单一关注点；大改动请拆分。

## 文档

- 行为变更时同步更新相关文档：
  - `AGENTS.md` —— 项目上下文与规范单一事实源
  - `docs/neeko-development-spec.md` —— 全栈架构规范
  - `docs/ARCHITECTURE.md` —— 架构总览
- 项目维护中英双语文档（`README.md` / `README_CN.md`、
  `CONTEXT.md` / `CONTEXT_CN.md`）。新增文档时建议同时提供中英两个版本。

## 发布流程

发布由 `pnpm release <version>`（`scripts/release.mjs`）驱动，它会：

1. 同步升级 `package.json`、`src-tauri/Cargo.toml`、`src-tauri/tauri.conf.json`
   三处版本号。
2. 用 `git-cliff`（配置在 `cliff.toml`）生成 `CHANGELOG.md`。
3. 提交 `release: v<version>` 并打 tag `v<version>`。

推送 tag 会触发 GitHub Actions 构建 Windows / macOS / Linux 三平台并发布
GitHub Release（含各平台安装包）。详见 `AGENTS.md` 的发布章节。仅拥有推送
权限的维护者执行发布。
