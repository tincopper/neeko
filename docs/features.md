# 能力清单（单一事实源）

> **本文件是 Neeko 产品能力的唯一登记处。** `README.md` / `README_CN.md` 的 Features 段是本文件的**摘要**，
> 不是另一个事实源：新增或删除能力时，先在这里登记（含锚点），再决定是否进 README。
>
> 维护规则（与 `tools/guards/checks/check_readme_claims.py` 配套）：
>
> 1. **锚点**指向目录或单文件，**禁止行号**（行号必然腐烂）；锚点必须真实存在。
> 2. `README` 列只写 `✅`（README 有提及）或 `—`（仅此登记，不进 README）。
> 3. 一句话只写"用户能做什么"，不写实现机制（三域分层、传输协议细节在 `ARCHITECTURE.md`）。
> 4. 数字类声明（语言数、Agent 数、主题数）必须能在锚点处复核。
>
> 最近核对：2026-10-28（app 1.0.9，shell: dock-islands；README 全面重写，新增 1.6 登记）

---

## 1. 多项目与连接（Projects & Connections）

| # | 能力 | 一句话 | 锚点 | README |
| --- | --- | --- | --- | --- |
| 1.1 | 三类项目 | 本地目录、WSL 发行版内目录、SSH 服务器目录统一进同一个侧栏与工作区 | `src-tauri/src/project/` | ✅ |
| 1.2 | Worktree 会话 | 每个 git worktree 有独立终端与工作目录，点侧栏即开或恢复 | `src-tauri/src/git/commands/worktree.rs` | ✅ |
| 1.3 | 重启恢复 | 项目列表、选中 Agent/IDE、worktree 状态、dock 布局分别持久化 | `src-tauri/src/session/` | ✅ |
| 1.4 | 侧栏整理 | 拖拽排序项目、行内重命名分支与 worktree、每项目头像色 | `src/features/project/components/` | ✅ |
| 1.5 | 项目级设置 | 每个项目单独覆盖 Agent/IDE/外观/任务，不动全局配置 | `src/features/settings/components/ProjectPanel.tsx` | ✅ |
| 1.6 | 从 Git 克隆 | 从仓库地址克隆项目，带流式进度反馈 | `src-tauri/src/project/clone.rs` | ✅ |

## 2. 终端与 Agent（Terminal & Agents）

| # | 能力 | 一句话 | 锚点 | README |
| --- | --- | --- | --- | --- |
| 2.1 | 独立 PTY | 每个项目（含 worktree / WSL / SSH）独立 PTY，切项目、切 tab 不断连 | `src/features/terminal/` | ✅ |
| 2.2 | 分屏与多 tab | 同一 tab 内可拆多 pane，跨项目多 tab 并存 | `src/features/terminal/components/SplitLayout.tsx` | ✅ |
| 2.3 | 内置 Agent | 10 个 CLI Agent 预设（Claude Code / OpenCode / Gemini / Codex / Qoder / CodeBuddy / OMP / Pi / Reasonix / Grok）+ 安装检测 | `src-tauri/src/agent/builtin/providers.rs` | ✅ |
| 2.4 | 即时切换 Agent | 同一 PTY 内切换 Agent，不必重建会话 | `src/features/terminal/components/terminalAgentSwitch.ts` | — |
| 2.5 | 自定义 Agent | 自定义命令/参数/环境变量；内置 Agent 可覆盖、Chat 能力三态开关 | `src/features/agent/components/AgentForm.tsx` | ✅ |
| 2.6 | CLI Hooks | 8 个外部 CLI（opencode / pi / omp / claude / codebuddy / qoder / codex / dsh）把运行状态回传到通知与状态栏 | `src-tauri/src/agent/hooks/targets/data.rs` | ✅ |
| 2.7 | TUI 主题同步 | 应用主题写入 OpenCode 与 Pi 的主题/项目配置，覆盖本地、WSL、远程 | `src-tauri/src/theme/service.rs` | ✅ |

## 3. Agent 对话（Agent Chat）

| # | 能力 | 一句话 | 锚点 | README |
| --- | --- | --- | --- | --- |
| 3.1 | 多 Agent 会话 | 同一界面里与不同 Agent 对话，4 条传输（opencode serve / Pi RPC / ACP / jsonl） | `src-tauri/src/agent/chat/adapter/registry.rs` | ✅ |
| 3.2 | 流式与工具卡片 | 读取、diff、命令、待办、技能、计划各自成卡，可回看 | `src/features/agent-chat/components/WorkRows.tsx` | ✅ |
| 3.3 | 审批与追问 | 工具调用审批、用户输入回填、计划确认 | `src/features/agent-chat/components/ApprovalPanel.tsx` | ✅ |
| 3.4 | 模型与上下文 | 模型选择（跨供应商图标）+ 上下文用量弹窗 | `src/features/agent-chat/components/ModelPicker.tsx` | ✅ |
| 3.5 | 会话恢复 | 列出历史会话并从 Agent 侧 resume | `src/features/agent-chat/components/ResumeList.tsx` | ✅ |
| 3.6 | 输入增强 | 附件、slash 命令、@ 提及补全 | `src/features/agent-chat/components/ComposerPalette.tsx` | ✅ |
| 3.7 | MockAgent | 未安装任何 CLI 时也能试用 Agent Chat | `src-tauri/src/agent/builtin/providers.rs` | — |

## 4. 编码（Editor / LSP / Debug / Run）

| # | 能力 | 一句话 | 锚点 | README |
| --- | --- | --- | --- | --- |
| 4.1 | 文件树与编辑器 | 项目文件树、多 tab、未命名文件、外部修改检测 | `src/features/editor/` | ✅ |
| 4.2 | 编辑组 | 左右拆分、tab 拖拽换组、钉住 tab | `src/features/editor/components/EditorGroupLayout.tsx` | ✅ |
| 4.3 | 富预览 | Markdown（GFM + mermaid + PlantUML）、HTML、SVG、图片、JSON | `src/ui/MarkdownPreview.tsx` | ✅ |
| 4.4 | 导航 | Quick Open、全局搜索、符号导航、引用 peek、命令面板 | `src/features/quick-open/` | ✅ |
| 4.5 | LSP | 内置 17 种语言的服务器配置（Rust/Go/Python/TS/JS/Java/C/C++/C#/Ruby/PHP/Swift/Kotlin/Lua/Elixir/R/SQL） | `src-tauri/src/lsp/plugin/builtins/all.rs` | ✅ |
| 4.6 | 诊断闭环 | Problems 面板、quick fix、接受补全时自动补 import | `src/features/lsp/components/ProblemsPanel.tsx` | ✅ |
| 4.7 | 语义导航 | 跳转定义、查找引用、hover（含 jdt:// 虚拟文档） | `src/features/lsp/api/` | ✅ |
| 4.8 | 自定义服务器 | 按扩展名注册自定义 LSP、生命周期策略、一键安装 | `src/features/settings/components/LspCustomServersSection.tsx` | ✅ |
| 4.9 | 调试 | DAP 断点、单步、变量、调用栈（Go / Java / Rust） | `src-tauri/src/dap/` | ✅ |
| 4.10 | 运行与测试 | Go / Java / Rust / TS 的入口与用例级运行，结果回填编辑器 | `src/features/runner/languages/` | ✅ |
| 4.11 | 任务与控制台 | 自动发现可运行任务；任务输出、LSP 日志、git 操作共用统一 Console | `src/features/task/` | ✅ |
| 4.12 | AI 注释翻译 | 按注释块分类、流式翻译、结果缓存 | `src/features/editor/comment/` | ✅ |
| 4.13 | AI 文档翻译 | Markdown / HTML / TXT 分块翻译，可选 Agent 与模型 | `src/features/editor/translation/` | — |

## 5. 版本控制（Version Control）

| # | 能力 | 一句话 | 锚点 | README |
| --- | --- | --- | --- | --- |
| 5.1 | 变更树 | 分层文件树 + 状态装饰；磁盘变更自动刷新 | `src/features/git/components/ChangesSection.tsx` | ✅ |
| 5.2 | Diff | 统一/并排、语法高亮、行级变更底色、变更块导航、合并提交视图 | `src/features/git/components/diff/` | ✅ |
| 5.3 | 分支与工作树 | 搜索式分支切换，新建/重命名/删除，worktree 增删 | `src/features/git/components/BranchSwitcherPanel.tsx` | ✅ |
| 5.4 | 暂存与冲突 | stash 管理、冲突文件解决 | `src/features/git/components/StashPanel.tsx` | ✅ |
| 5.5 | 提交与同步 | commit（可由 Agent 生成 message）、push/pull、凭据提示 | `src/features/git/components/CommitDialog.tsx` | ✅ |
| 5.6 | 历史与 PR | git graph、cherry-pick、tag；PR 列表/详情/评审/合并（需 `gh`） | `src/features/git/components/gitlog/` | ✅ |

## 6. 资源与信息（Library & Signals）

| # | 能力 | 一句话 | 锚点 | README |
| --- | --- | --- | --- | --- |
| 6.1 | 资源库 | Skill / 提示词 / MCP 三类资源统一浏览与搜索 | `src/features/library/components/LibraryPanel.tsx` | ✅ |
| 6.2 | Skill 市场 | skills.sh 榜单与搜索安装 | `src-tauri/src/library/skill/skillssh_api.rs` | ✅ |
| 6.3 | MCP 市场 | MCP Registry 搜索安装与服务器管理 | `src-tauri/src/library/mcp/mcp_registry_api.rs` | ✅ |
| 6.4 | 提示词复用 | 提示词插入 Agent 输入框或当前终端 | `src/features/library/hooks/useInsertPromptToWorkspace.ts` | ✅ |
| 6.5 | Skill 同步 | tag group 绑定项目，按 Agent 目录部署/解绑 | `src-tauri/src/library/skill/sync_engine.rs` | ✅ |
| 6.6 | 内嵌浏览器 | WebView 面板 + 页面元素拾取到剪贴板 | `src/features/browser/` | ✅ |
| 6.7 | 会话历史 | 扫描各 Agent 会话文件，搜索、恢复、导出 | `src/features/conversation/` | ✅ |
| 6.8 | 通知 | 应用内通知中心 + 桌面通知（macOS 点击直达对应项目） | `src/features/notification/` | ✅ |
| 6.9 | 状态栏 | 分支、LSP、问题、调试、冲突、光标、通知共 9 项 | `src/features/status-bar/registry.ts` | ✅ |
| 6.10 | 设置 | 11 类全局设置 + 项目级覆盖；快捷键可改并检测冲突 | `src/features/settings/components/constants.ts` | ✅ |

---

## 附：与 README 的映射

| README 分组 | 本文件条目 |
| --- | --- |
| Projects & Connections | 1.1 – 1.5 |
| Terminal & Agents | 2.1 – 2.7 |
| Agent Chat | 3.1 – 3.7 |
| Coding | 4.1 – 4.13 |
| Version Control | 5.1 – 5.6 |
| Library & Signals | 6.1 – 6.10 |
