# 历史会话删除（三态删除能力）

## Goal

让 Conversations 面板能删除一条历史会话，且**删的就是用户看到的那一条**：有官方命令的 agent 委派它自己的
CLI（它维护索引 / SQLite / 级联子会话），没有官方命令的由 adapter 删自己的存储单元（含兄弟文件），
无法安全删除的隐藏入口。

## Background（一手实测，2026-10-30）

会话数据的**拥有者是各个 agent**，Neeko 只有一份内存索引（`conversation-adapter.md` §2.2：无持久化）。
所以「删除」必须由拥有者执行 —— 绕过 CLI 直接删文件会留下陈旧索引/孤儿行。

本机实测的删除能力：

| Agent | 官方删除命令 | 与 Neeko 读取的存储是否同一处 | 结论 |
| --- | --- | --- | --- |
| codex | `codex delete --force <uuid\|name>`（永久，**无 TTY 必须 `--force`**）+ `archive` | 是（`~/.codex/sessions/**`） | **委派** |
| opencode | `opencode session delete <sessionID>`（含子会话级联） | 是（同一 SQLite，经后台 server） | **委派** |
| claude | `claude rm <id>` 只删 **background session**；`claude purge` 是**全清** | 否（会话 jsonl 在 `~/.claude/projects/**`） | 删存储单元 |
| pi | 无（`pi list` 是扩展包） | — | 删存储单元 |
| grok | 无 | — | 删存储单元（会话是**目录**：`summary.json` + `updates.jsonl`） |
| omp | 无（只有 `--export`） | — | 删存储单元 |
| reasonix | 无（`session list/show/status` 只读） | — | 删存储单元（`<id>.jsonl` + 兄弟 `<id>.events.jsonl`） |
| qoder | `qoder --delete-session <index>` | **否**：CLI 用 `~/.qoder/`，Neeko 读 `~/.qodercli/projects/` | 删存储单元（委派会删错库） |

> qoder 是本设计里最有价值的一行：**「有命令」不等于「该委派」**。委派的前提是
> 「CLI 删的就是 Neeko 列出的那一条」—— 存储路径不同时委派等于删别人的数据。
> 另：qoder 命令按**索引**寻址（`--list-sessions` 顺序），索引随删除漂移，也是不委派的第二条理由。

## Requirements

### R1 三态删除能力（不是 bool）

- R1.1 `AgentSessionAdapter` 新增 `delete_support()`，三态：
  `Native`（委派 CLI）/ `Storage`（adapter 删存储单元）/ `Unsupported`（无安全路径）。
- R1.2 扫描时把该三态写进 `ConversationMeta.delete_support`（与既有 `supports_resume`
  同一模式：一次扫描定事实，UI 不额外发查询）。
- R1.3 新增 adapter 时若忘记表态 → 编译或契约测试失败（与 `ChatCapabilities` 同判据）。

### R2 删除执行（命令层只做校验 + 调度）

- R2.1 新命令 `delete_conversation(id)`：**只接受 conversation id**，存储路径由后端从自己的缓存解析
  —— 前端永远不能指定要删哪个文件/目录。
- R2.2 `Native`：按 adapter 给出的 argv 走 `core::exec`（红线 1/2），拿到退出状态与 stderr；
  非零退出 → `AppError`，**不假装成功**。
- R2.3 `Storage`：本地 fs 删除包 `spawn_blocking`（红线 3）；删除单元由 adapter 定义
  （见 R4 的边界）。
- R2.4 若解析出的路径不在该 adapter 的 `session_root` 之下 → 拒绝执行（防线：缓存被污染时也不越界）。
- R2.5 删除成功后从 manager 缓存注销该条（列表立刻消失），并让 scan 缓存失效（下次扫描不复活）。

### R3 使用中保护

- R3.1 **活的 Agent Chat 会话**（`resumeConversationId` / `resumeNativeSessionId` / `sessionId`
  命中）占用这条会话时**阻断删除**并提示「先关闭该会话」—— 那时可能有 agent 进程正握着会话文件在写。
  **只读的会话查看器 tab 不算占用**（面板里点一行就会开它；算作占用等于让功能永远不可用 ——
  2026-10-30 实测 pi 删除被这条误判挡住）；删除成功后由容器层关掉这些查看器 tab。
- R3.2 确认对话框必须显示「agent · 标题 · 将要发生什么（执行哪条命令 / 删除哪个路径）」。

### R4 删除边界由 adapter 定义

| Agent | 删除单元 |
| --- | --- |
| pi / claude / qoder / gemini | 会话单文件（gemini 为 `chats/<session>.json`） |
| grok | 会话**目录**（`summary.json` + `updates.jsonl`） |
| reasonix | `<id>.jsonl` + 兄弟 `<id>.events.jsonl` + `<id>.jsonl.meta`（实现期确认，三者都只属于这条会话） |
| omp | 主会话 `*.jsonl`（附属 trace 目录不在本期） |
| codex | `codex delete --force <uuid>`（无 TTY 时 `--force` 是硬要求；`--force` 又要求 UUID） |
| opencode | `opencode session delete <id>`（SQLite + 子会话级联；实测无确认提示） |
| codebuddy | `Unsupported` —— 文件头声称可能有 SQLite 权威存储，未实测 ⇒ fail-closed（宁可没入口，也不给删不干净的按钮） |

**共享资产不删**：pi 的 blob（`file:///…/blobs/<sha>.png`）是内容寻址、跨会话共享 ⇒
任何情况下都不删。

### R5 UI

- R5.1 Conversations 面板行内新增删除按钮，仅 `delete_support !== Unsupported` 时出现。
- R5.2 复用既有确认弹窗（`shared/store/confirmStore`），不新造模态。
- R5.3 删除后行消失、计数减一，无需整页刷新；失败时 toast 显示真实原因（含 stderr 摘要）。

## Constraints

- 红线 1/2（命令只经 `core::exec`/`common::executor`）、红线 3（本地 fs 包 `spawn_blocking`）、
  红线 6（命令层极薄）、红线 8（路径只从后端缓存解析，且校验落在 `session_root` 内）、
  红线 10（agent 差异落 adapter，不写 `agent_id ==` 分支）。
- 不新增依赖。
- TDD：纯函数（能力映射、删除计划 argv 构造、边界路径判定）100% 覆盖；委派路径用假二进制验证 argv，
  不真跑 codex/opencode。

## Acceptance Criteria

- [x] AC1 codex 会话删除：走 `codex delete --force <uuid>`，成功后被删会话从列表消失，`~/.codex` 里对应
      rollout 与其索引条目都不再出现（由 codex 自己维护，可 `codex resume` 验证不列出）。
- [~] AC2 opencode 会话删除：走 `opencode session delete <ses_id>`，子会话一并消失。
      *（命令与无交互确认已实测；真机会话删除未跑 —— 需授权删一条可弃会话）*
- [x] AC3 pi / claude / qoder：删单文件；grok 删会话目录；reasonix 删主文件+兄弟事件文件。
- [~] AC4 pi 会话删除后 `~/.pi/agent/blobs/**` **无变化**（共享资产不被删）。
      *（机制级护栏 `pi::delete_unit_is_the_session_file_inside_the_session_root` 断言 blob 永远
      过不了所有权判定；真机 blobs 未逐一比对）*
- [x] AC5 使用中保护按**新契约**工作（设计在实测后修正）：只读查看器 tab 不阻断；挂在
      Agent Chat 里也不阻断 —— 确认框说明「那个 tab 会一起关掉」，删除成功后才关 tab；
      删除失败不关任何 tab（用户还能继续看那份仍存在的会话）。
- [x] AC6 前端无法指定路径：命令只收 id（代码审查 + 单测：不存在的 id → `NotFound`，不触碰磁盘）。
- [x] AC7 删除失败时错误可归因（委派非零退出含 stderr 尾部；真实 IO 错误报「哪个目标失败 + 哪些已删」），
      列表不乐观移除。**目标已不存在按「已删」处理（幂等）** —— 老会话常缺兄弟文件/目录成员，
      那不算失败。
- [x] AC8 `pnpm check:quick` 绿；`cargo test --lib` 绿。

## Out of Scope

- 批量删除 / 按项目清空。
- 「收藏 / 隐藏」这类 Neeko 自有持久化状态（会引入第二份真相，见 design §4）。
- omp 的附属 trace 目录清理。
- 删除远端（WSL/SSH）会话：会话存储始终在本机 `$HOME`，不存在该场景。
