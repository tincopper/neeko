# 设计：团队会话恢复（会话身份 ↔ 进程资源分家）

> 读这份文档只需要记住一句话：
> **进程会死，对话不会死；把「对话」这个对象补进数据模型，恢复就是它的必然推论。**

## 0. 事实基线（已核实，含行号）

| 事实 | 位置 |
| --- | --- |
| 团队 argv 只来自准入表模板：`mcp_argv` + `prompt_argv`（preamble 是位置参数） | `agent/team/execution.rs:197`、`:227` |
| 团队 launch **硬编码** `resume_from: None`，且 `agent_session_id` 在启动路径上从未被读取 | `app/team_executor.rs:207` |
| 非团队 resume 早已存在：`resume_command`（claude `--resume` / codex `resume` 子命令 / pi `--session`） | `conversation/adapter.rs:123`、`adapters/codex.rs:255`、`adapters/claude_code.rs:259` |
| `TerminalLaunch.resume_from` **不是** CLI resume，是纯 shell 历史回放（`read_tail` + `replay_payload`） | `terminal/launch.rs:22-24`、`terminal/router.rs:110-124` |
| 活性真相在 `TerminalRouter` 的 owners 表；`live_sessions` 只是带 `native_session_id` 的元数据投影，且只在 `has_user_input` 时落盘 | `terminal/router.rs:141-147`、`live_sessions/cursor.rs:87-90`、`:141` |
| 原生 id 有两个门控不同的记录者：团队域按 4 种事件键门控；live_sessions 无门控 | `agent/team/observe.rs:98` vs `live_sessions/wiring/hooks.rs:118-121` |
| 凭证是 **per-process**：每次 spawn 重新 admit 生成新 uuid，库里只存 hash；端点每次 boot 随机端口 | `agent/team/manager.rs:1040`、`agent/team/boot.rs:102-104` |
| `Closed` / `Dead` 是吸收态；没有任何赋值回 `Active`；`start_member` 只对刚建的行 | `manager.rs:1421-1480`、`:1557-1614`、`commands.rs:65-70` |
| `MemberSignal::Exited` 在生产代码里**没有生产者**；PTY 退出只通知 live_sessions | `agent/team/observe.rs:73-88`、`live_sessions/wiring/pty.rs:291-298` |
| app 重启后 `TeamManager::load` 是纯读，无归位 | `manager.rs:360-390` |
| 历史 scope = `Project { path }` + 原始字符串前缀 + `/` 边界 | `conversation/types.rs:198`、`conversation/manager.rs:1322-1336` |
| 团队注册会话时把 `worktree` 维度丢了（`of(project_id, None)`），而 `cwd` 可能是 worktree | `app/team_executor.rs:197` vs `:426`（`execution.rs`） |

## 1. 目标模型

### 1.1 三个层次，三种寿命

```
身份（durable, 跨重启）       归属（durable, 跨重启）        资源（ephemeral, 进程期）
─────────────────────────    ─────────────────────────    ────────────────────────────
(agent_id, native_session_id) member_id → owner            PTY session id / token / MCP 端口
team / member / task 行        team_id → project + worktree  owner→session 的实时映射
```

- 身份由**会话域**（hook ingest → `SessionRegistry`）拥有。
- 归属由**起进程的一方**在 launch 时写入（`SessionOwner`），终端域持有。
- 资源由**终端域**（`TerminalRouter`）与**团队域**（凭证铸造）以进程期为界持有。

团队域从此只读**身份**与**归属**（经读接口），不持有任何资源句柄。

### 1.2 状态语义改写（意图 ≠ 运行态）

| 旧 | 新 | 含义 |
| --- | --- | --- |
| `TeamState::Active` | `TeamState::Open` | 团队可派活、**可恢复** |
| `TeamState::Closing` | `Closing`（保留） | 一次进行中的关闭操作（可重试） |
| `TeamState::Closed` | `TeamState::Sealed` | 用户显式封存：只读、可删、**不可恢复** |
| `MemberState::Dead` | `MemberState::Offline` + `sealed_at` | `dead` 同时表达了「进程没了」与「用户关掉了它」；两者在恢复语义上相反 |

**运行态永远可以由现实推导**：进程不在 ⇒ 运行态不可能是 `running`。
因此 `offline` 是**一致性投影**，不是一个新的用户动作；恢复操作只改资源，不改身份。

`sealed_at`（成员级）与 `TeamState::Sealed`（团队级）是**用户意图**，只有用户动作能写。

### 1.3 前端四态（判据仍只有一处）

`memberTerminal.ts::openTerminalAction` 从两态扩到四态，输入从
`{ terminalId, agentSessionId }` 变成**一个** `MemberSession` 事实对象：

| 事实 | 动作 | 文案 |
| --- | --- | --- |
| `live=true` | 接管活 PTY | 打开会话 |
| `live=false, native=Some, sealed=false` | **恢复**（新进程 + resume argv） | 恢复会话 |
| `live=false, native=Some`（sealed 或团队 sealed） | 只读历史 | 查看记录 |
| `live=false, native=None` | 置灰 | 没有任何会话记录 |

判据仍在一处（纯函数），四态各自有测试。

## 2. 契约

### 2.1 `SessionOwner`（新增，归属键唯一写入点）

```rust
// src-tauri/src/live_sessions/… 或 terminal/…（与 owners 表同一处）
pub enum SessionOwner {
    User,
    TeamMember { team_id: String, member_id: String },
}
```

- 写入点：`TerminalRegistration` 增 `owner: SessionOwner`；`team_executor::spawn` 填
  `TeamMember { team_id, member_id }`（它本来就有 member 行），其他调用点填 `User`。
- 为什么**不**从 hook 的 `EnvHints` 反推归属：hooks 可能没装、可能被关（`hooks: bool` 在准入表里）、
  可能在进程没发任何事件前就退出。**起进程的那一刻是唯一 100% 已知的时刻**（开闭原则：
  新归属类型 = 新 variant，读取侧 `match` 强制处理）。

### 2.2 读接口（红线 17：要问就问对方的读接口）

```rust
/// 组装花名册时注入（依赖倒置）；生产实现由 `app/` 组合根装配 terminal + live_sessions。
pub trait MemberSessionLookup: Send + Sync {
    fn session_of(&self, team_id: &str, member_id: &str) -> MemberSession;
}

pub struct MemberSession {
    /// 活着的 PTY 句柄（仅当 `live`）。
    pub terminal_id: Option<String>,
    pub live: bool,
    /// 这个成员最近一次被观察到的原生会话 id（durable）。
    pub native_session_id: Option<String>,
}
```

- `live` 来自 `TerminalRouter::owns_terminal_session`（活性唯一真相）。
- `native_session_id` 来自 `SessionRegistry`（hook ingest 无门控写入，已有机制）。
- 团队域**不缓存**结果（红线 17）：`team_snapshot` / `team_member_detail` 每次组装时查询。
- `view.rs` 仍是视图构造的唯一落点 —— 它多收一个 `&dyn MemberSessionLookup` 参数，
  而不是自己去读别的域。

### 2.3 resume argv（逐 CLI 数据，红线 15）

```rust
/// 「续接这个原生会话」的 argv 片段。**不是** shell 字符串（codex 是子命令，顺序敏感）。
pub struct ResumeArgv {
    /// 紧跟 program 之后（`codex resume <id>` / `claude --resume <id>`）。
    pub prefix: Vec<String>,
    /// 追加在准入参数之后（留给「必须最后出现」的 CLI）。
    pub suffix: Vec<String>,
}

// conversation::Adapter trait 新增（默认 None = 该 CLI 不支持恢复）
fn resume_argv(&self, native_session_id: &str) -> Option<ResumeArgv>;
```

- `resume_command()`（现有，返回 `Vec<String>` 全量命令）保留给终端域的「任务终端」路径；
  团队路径只吃 `ResumeArgv`，因为团队 argv 的后半段由准入表决定。
- 组合顺序（**唯一实现**，`launch_argv`）：
  `[program] ++ resume.prefix ++ admission.mcp_argv ++ bypass_args ++ admission.prompt_argv ++ resume.suffix`
- 逐 CLI 的 `prefix`/`suffix` 取舍必须由一次真实 smoke test 定（见 implement.md S2），
  不许靠文档猜。

### 2.4 `team_resume`（新命令）

```rust
#[tauri::command]
pub async fn team_resume(state, team_id: String) -> Result<TeamResumeReport, AppError>;

pub struct TeamResumeReport {
    pub resumed: Vec<String>,        // member_id
    pub skipped_already_live: Vec<String>,
    pub cold: Vec<ColdMember>,       // 无原生 id ⇒ 只能新开
    pub failed: Vec<MemberFailure>,  // 逐成员失败不吞（两相位设计的既有语义）
}
```

- 前置判据：团队存在且 `state == Open`；`Sealed` ⇒ 明确错误（AC-9）。
- 每个成员：`sealed_at.is_none()` 且 `native_session_id.is_some()` ⇒ 走「重建资源 + resume argv」。
- **复用同一条执行路径**：`execution::start_member` 增 `resume: Option<NativeSessionRef>` 入参
  （admit → provision → spawn 三相位不变）。不新写第二条 spawn 实现。
- 幂等：`live == true` 的成员跳过并计入 `skipped_already_live`（AC-7）。

## 3. 数据迁移（v22）

一个版本、三件事（分三个版本会让 `upsert_member` 被重写两次）：

```sql
-- team: 意图化
UPDATE team SET state = 'open'   WHERE state = 'active';
UPDATE team SET state = 'sealed' WHERE state = 'closed';
ALTER TABLE team RENAME COLUMN closed_at TO sealed_at;
ALTER TABLE team ADD COLUMN workspace_worktree TEXT;  -- S3：工作区身份（NULL = 无工作树）

-- team_member: 资源与身份出列
UPDATE team_member SET state = 'offline' WHERE state = 'dead';
UPDATE team_member SET state = 'open'    WHERE state IN ('spawned','running','awaiting','idle','done','failed','stalled');
ALTER TABLE team_member ADD COLUMN sealed_at TEXT;
ALTER TABLE team_member DROP COLUMN terminal_id;
ALTER TABLE team_member DROP COLUMN agent_session_id;
```

- `state='open'` 这一步不是"多此一举"：迁移后的运行态语义里，`open` 表示「未封存、当前无进程」，
  由 boot 归位（§4）统一写入 `offline`。迁移只做**值的合法化**，不做推断。
- `DROP COLUMN` 需要 SQLite ≥ 3.35（rusqlite `bundled` 已满足）。
- **代价必须写下**：升级后，升级前就退出的成员不再有「查看记录」入口（它们的原生 id 只存在过
  被删列里）。它们的 transcript 仍会出现在 History 面板 —— 这正是 S3 要修的那条路，
  也是用户「历史里找不到」的真正出口。要保留旧数据的话，在 post-check 里加一条
  「升级前已知 native id 的成员数」统计，写进 release note。

## 4. boot 归位（reconcile）

`TeamManager::load` 之后，由 `app/boot.rs` 调 `team::boot::reconcile(&manager)`：

1. 每个成员：运行态 → `Offline`（进程不可能跨重启）。
2. 每个非空 `token_hash` → 清空（**凭证寿命 = 进程寿命**；否则重启后 principal 表仍授权给
   已经不存在的进程 —— 那是一条幽灵授权）。
3. `team.state == Closing` → `Open`（关闭被重启打断，让用户重试）。
4. 每队写一条 `system` 审计 `reconcile`，`detail` 写 N 个成员归位 + mention 清理的凭证数。

为什么写在 boot 而不是 `TeamManager::load`：`load` 是纯读（可被测试、可被多次调用）；
归位是**写**，必须显式、有审计、有单一入口（红线：单一职责）。

## 5. 历史归属（S3）

### 5.1 团队记录工作区身份

`team` 行新增 `workspace_worktree`（`workspace_ref` 的工作树维度）。
建队时由前端传（已有 `activeWorkspace`），`start_team_session` 落库。
`TeamLaunchPanel` 不再只传 `projectPath`。

### 5.2 scope 从路径改为身份

```rust
pub enum ConversationListScope {
    /// 项目级：该项目**全部工作区**（含 `~/.neeko/worktrees/*` 这类外部工作树）。
    Project { project_id: ProjectId, paths: Vec<PathBuf> },  // paths 由项目域解析、调用方填充
    Unit { workspace: WorkspaceSession },                     // 不变
}
```

- `paths` **由项目/工作树域解析后传入**，conversation 域不自己拼接（红线 12）。
- 现有 `scope.rs` 的目录编码与 `matches_project_path` 保留为**纯函数**，输入从「一个 project 根」
  变成「一组已知根」（`Vec`）—— 逐 CLI 适配器的发现逻辑不改。
- 前端 `ConversationsPanelWrapper` 不再传 `worktreePath ?? project.path`（那是路径身份），
  改传 `projectId + workspace`。

### 5.3 侧栏分组

团队会话注册用团队行的 `workspace_ref`（§5.1），不再 `WorkspaceSession::of(project_id, None)`。
于是 `workspaceKey` 精确相等分组自然命中。

## 6. 反方案（为什么不做）

| 方案 | 拒绝理由 |
| --- | --- |
| 只加一个 `team_resume` 命令（把 `terminal_id` 留着，按需重建） | 治不了根：`terminal_id` 仍是身份判据，重启后仍显示「可点但必失败」；且 resume 需要 durable 原生 id，而它被门控记录 |
| 在 `team_member` 上新增 `resume_argv` 或 `--resume` 字符串列 | 把逐 CLI 知识写进数据（违反红线 15）；argv 顺序敏感，字符串会二次解析 |
| 让团队域订阅 PTY 退出事件，把成员标 `Dead` | 只补了"退出"的表示，仍然没有"可恢复"的对象；崩溃时事件也不保证送达（`rev` 脉冲不保证送达） |
| 让 conversation 域用「路径后缀 / 名字匹配」把 `~/.neeko/worktrees/x` 归到项目 | 路径反推身份（红线 12），多项目同名工作树立刻串台 |
| 把 live_sessions 行加 `team_id` 列，团队域 join 它 | 两个 DB 文件（`neeko.db` / `agent_sessions.db`）无法 join；且那是**影子副本**（红线 17） |
| 保留 `token_hash` 跨重启（现状） | 幽灵授权：principal 表仍授权给不存在的进程；且端口已换，token 已不可用 |

## 7. 风险与代价（写下来，别假装没有）

1. **迁移不可逆地删两列** —— 旧成员的历史入口靠 S3 补回，但需要 S3 落地才完全恢复体感。
   收尾顺序因此不能反转：S1 必须在 S3 之后才能算「用户可见地修好了」。
2. **`SessionOwner` 只覆盖本地 PTY** —— WSL / SSH 的 `extra_env` 是 `Unsupported`，
   所以团队目前只能是本地；把这一点写成断言（团队创建时若环境非 Local ⇒ 拒绝或明确降级）。
3. **resume argv 的顺序是经验知识** —— 每个 CLI 一次 smoke test；smoke test 失败则降级为
   `cold`（明确说「这个 CLI 不支持恢复」），而不是赌一次错误 argv。
4. **`offline` 归位会改变现有测试期望**（很多测试假定 `Dead` / `Active` / `Closed` 字面值）；
   这是一次**有意的语义迁移**，用类型名强制编译器指出所有落点（`Dead → Offline` 不做
   别名兼容，宁可一次改干净）。
5. **`team_send` 由"静默成功"变成"明确失败"** 是行为变更；spec 里要写清排查入口
   （先看花名册的 `live` 与 `state`，再 `team_resume`）。

## 8. 验收锚点（测试形状）

| 判据 | 形态 |
| --- | --- |
| 门控被删（AC-2） | `observe` 收到 `session_started` 也写入原生 id（单测 + 一条「未知键仍不产生信号」的对照） |
| 运行态可推导（AC-3） | `reconcile` 后快照全部 `live=false` / `offline`；`team_send` 返回 `Conflict` |
| 凭证寿命（AC-4） | `principals_from` 在 reconcile 后为空（单测直接在 manager 上断言） |
| resume argv 形态（AC-6） | 逐 CLI 的 `resume_argv` 单测 + 一次 `launch_argv` 组合顺序断言（codex 子命令在前） |
| 幂等（AC-7） | 两次 `team_resume` ⇒ 第二次全 skip，不产生新审计 |
| 四态判据（AC-5） | `openTerminalAction` 纯函数四条 + 花名册渲染四条 |
| 历史归属（AC-10） | conversation 列表用「项目根 + 外部工作树」两组 paths 的夹具（`tempdir` 推导，红线 13） |

---

## 9. 实施期修正（S1 动手时核出的三条事实，推翻 §2 的两处假设）

### 9.1 `live_sessions` **不能**作为原生 id 的持久所有者

`live_sessions::wiring::pty::on_exit` 在**进程自然退出**时**删除整行**（`pty.rs:400+`，
判据 `natural_exit_deletes_the_row_while_an_explicit_close_keeps_it`，靠 `session_cursors`
的行去留表达）。只有「用户点 X 关掉」才保留 `Stopped` 行。

⇒ 若删掉 `team_member.agent_session_id`，一个自然退出的成员就**永久丢失**它的对话身份，
恢复再也无从谈起。这与 §2.2「团队域不缓存」自相矛盾。

**修正**：`agent_session_id` **保留**在成员行上。它不是资源，而是「这名成员正在哪个对话里」
这条**身份绑定** —— 全仓没有第二个持有者（会话域的条目随退出被删、缓存由磁盘重建且不认成员），
所以在红线 17 的判据下它不是影子副本，而是唯一副本。要修的是**记录门控**（R1），不是搬家。

被删的只有真正的进程资源：`team_member.terminal_id` 与 `team.lead_session_id`
（后者是 PTY 句柄且**零读取方**，只写不读）。

### 9.2 活性真相不在 `TerminalRouter::owners` 里

`owners` 表只在 `close_session`（`take_owner`）里被摘除；**进程自然退出不会摘**（退出路径
只有 live_sessions 注册表的句柄）。所以 `owns_terminal_session(dead_id) == true`，
它答的是「这个 id 曾经登记过」，不是「它还活着」。

**修正**：活性改用 **live_sessions 条目的状态**，那是唯一跟着真实进程生命周期走的事实
（自然退出 → 行删除；显式关闭 → `Stopped`；`SessionState::is_terminal()` 即"没有进程"）。

### 9.3 归属键落在 `live_sessions`，不落在 router

归属（哪条会话属于哪个成员）只在**起进程那一刻**已知，写入点因此是
`TerminalRegistration`（只有 2 个生产构造点：`app/team_executor.rs` 与 `terminal/commands.rs`）。

`SessionEntry` 新增 `attribution: SessionAttribution`（`User` / `TeamMember { team_id, member_id }`），
登记即写入、注销即消失 —— **生命周期与条目完全一致，不需要第二套清理逻辑**。
`SessionOwner` 这个名字已经被 `terminal/router.rs` 占用（含义是「哪个后端持有」），
故归属键命名 **`SessionAttribution`**。

查询：

```rust
Registry::live_session_for_member(team_id, member_id) -> Option<&str>
// 过滤 attribution == TeamMember{..} 且 !state.is_terminal()
```

团队域只经 `view::MemberSessionLookup` 问它，不存副本。
