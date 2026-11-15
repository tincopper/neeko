# 会话历史的范围与身份（history scope & identity）

研究范围：`conversation` 域（历史会话）与 `live_sessions` 域（侧栏会话）**如何决定一条 CLI 会话属于哪个项目/单元**，
以及团队成员（队长）跑在这些域里的形态。只读研究，不改产品代码。

已确立、本文不复述的前提（见同目录 `liveness-and-launch.md`）：

- 团队根 `team.project_path` 可以是项目目录**之外**的 worktree（`~/.neeko/worktrees/<name>`）。
- `team_member.agent_session_id` 只在 4 类 hook 事件上被记录；`live_sessions` 对同一个 native id 不设事件门。

本文回答四个问题，每个结论都带 `file:line`。

---

## Q1 — 会话历史（History 面板）如何被填充、范围如何生效

### 1.1 完整读路径（前端 → 命令 → 管理器 → 磁盘）

```
ConversationsPanelWrapper           src/app/dock/wrappers/ConversationsPanelWrapper.tsx:51
  projectPath = worktreePath ?? project?.path ?? null
        ↓ props.projectPath
ConversationPanel → useConversationList(src/features/conversation/hooks/useConversationList.ts)
        ↓ ① hydrate（list）  :121-122  listConversations({kind:'project', path:projectPath}, …, {limit})
        ↓ ② 后台扫描         :147     scanConversations(undefined, projectPath)
        ↓ ③ 重取第一页       :151-152 listConversations({kind:'project', …})
        ↓ ④ 加载更多         :224     listConversations({kind:'project', path:projectPath}, …)
conversationApi.ts:36-51            invoke('list_conversations', …)
conversationApi.ts:15-17            invoke('scan_conversations', …)
        ↓
src-tauri/src/conversation/commands.rs:103 list_conversations(scope, …)
        → hydrate_from_disk_index_if_empty()（commands.rs:118 附近；管理器 manager.rs:144）
        → ConversationManager::list_page(scope→ListScope, …)   manager.rs:579
src-tauri/src/conversation/commands.rs:46  scan_conversations(agent_id, project_path, …)
        → ConversationManager::scan_agent / scan_agents       manager.rs:315 / 215
        → scan_agent_inner                                    manager.rs:348
        → adapter.discovery_roots(project_path) → walk_roots  manager.rs:387-406
        → WalkDir + pattern → adapter.parse_meta → 写入内存 cache（**不过滤项目**）manager.rs:410-495
        → persist_disk_index()（~/.neeko/conversation-index.json）commands.rs:88 / disk_index.rs:45
```

要点：

- **扫描期（discovery）与列表期（filter）是两道独立的关卡**，两者的判据不是同一份实现：
  - discovery 用「路径字符串 → 目录名编码前缀」（`scope.rs`）；
  - list 用「`ConversationMeta.project_path` 字符串前缀」（`manager.rs:1322`）。
- 适配器**没有** `discovery_roots` 覆写的一律整根遍历（`manager.rs:397-406` 的 `None => vec![session_root]`），
  于是它们的会话**全部进缓存**，项目归属只在 list 时用 `matches_project_path` 过滤。

### 1.2 范围（scope）到底是什么 key

Wire 形态是判别联合，两个变体互斥（`src-tauri/src/conversation/types.rs:196-210`）：

```rust
pub enum ConversationListScope {
    Project { path: String },          // 项目级（History 面板）
    Unit { workspace: WorkspaceSession }, // 单元级（agent-chat 恢复列表）
}
```

- **History 面板用的是 `Project { path }` —— 一个裸路径字符串**，不是 `ProjectId`、也不是 `WorkspaceSession`。
  `ConversationsPanelWrapper.tsx:51` 取的 `worktreePath ?? project.path` 是「当前激活单元的宿主路径」。
- 服务端把它翻成 `ListScope::Project(&str)`（`manager.rs:28-35`），过滤谓词是
  `matches_project_path(session_cwd, project_path)`（`manager.rs:1322-1336`）：

```rust
session == project                       → true
session.starts_with(project) && 下一字符 == '/'  → true
否则 false（含 session_project 为空 / None ⇒ false，fail-closed）
```

  即「**纯字符串前缀 + `/` 边界**」，没有任何 `WorkspaceRef` / `ProjectId` 参与。
- 唯一使用**已注册地址**的入口是 `Unit { workspace }` → `AppStateWrapper::resolve_unit_scope`
  （`commands.rs:128-132`、`app_state.rs:427-435`）→ `UnitScope::resolve`（`common/git/unit_scope.rs:106`），
  再由 `UnitScope::owns`（`unit_scope.rs:130-141`，规则：**最深根胜出**）判定归属。
  **History 面板不走这条路**；只有 agent-chat 的「最近可恢复会话」列表走
  （`src/features/agent-chat/hooks/useChatRestore.ts:105-113`）。

`scope.rs` 全文规则摘要（`src-tauri/src/conversation/scope.rs`，171 行）：

| 项 | 规则 | 行 |
| --- | --- | --- |
| `normalize_project_path` | `\`→`/`，去尾斜杠 | 31-38 |
| `encode_claude_project_path` | 非 ASCII 字母数字 → `-`（`/a/b` → `-a-b`） | 41-48 |
| `encode_pi_project_path` | `--` + 去首 `/`、`/`→`-` + `--` | 51-58 |
| `encode_omp_project_paths` | 先 home 相对（`-RustroverProjects-neeko`），再补全路径编码 | 59-82 |
| `dir_matches_project_scope` | `dir == prefix` 或 `dir.starts_with(prefix + "-")` | 95-106 |
| `resolve_encoded_project_dirs` | 先精确命中，再 readdir 收 `prefix-…` 扩展（worktree/嵌套），缺根 ⇒ 空 | 109-152 |
| `discovery_roots_for` | `None` 项目 ⇒ `None`（调用方全根遍历）；`Some("")` ⇒ `Some([])`（**早停**，扫 0 条且不是缺陷） | 160-176 |

编码边界的关键后果：`~/.neeko/worktrees/feat-team` → `-Users-tomgs--neeko-worktrees-feat-team`
（`.neeko` 的点也变 `-`），**它不是** 项目根编码 `-Users-tomgs-RustroverProjects-neeko` 的 `prefix-` 扩展，
所以「项目级扫描」**根本不会走进 worktree 的编码目录**（这一条对 claude-code / pi / omp / reasonix 四个
scoped adapter 成立：`adapters/claude_code.rs:41`、`pi.rs:37`、`omp.rs:84`、`reasonix.rs:265`）。

### 1.3 转录文件落点（per-CLI 目录约定）

唯一事实源：`common/agent/descriptor.rs` 的 `AGENTS` 静态表（`descriptor.rs:191-286`）。

| agent id | 转录根 | glob | 备注 |
| --- | --- | --- | --- |
| `claude-code` | `<config_root>/projects`（`CLAUDE_CONFIG_DIR` 优先，否则 `~/.claude`） | `**/*.jsonl` | `descriptor.rs:113-115, 192-199` |
| `codebuddy` | `~/.codebuddy/projects` | `**/*.jsonl` | `descriptor.rs:118-121, 200-207` |
| `qoder` | `~/.qoder/projects` | `**/*.jsonl` | `descriptor.rs:124-127, 208-215` |
| `codex` | `<CODEX_HOME | ~/.codex>/sessions` | `rollout-*.jsonl` | `descriptor.rs:130-136, 216-223` |
| `pi` | `~/.pi/agent/sessions` | `*.jsonl` | `descriptor.rs:140-143, 224-231` |
| `omp` | `~/.omp/agent/sessions` | `*.jsonl` | `descriptor.rs:146-149, 232-239` |
| `opencode` | `$OPENCODE_CONFIG_DIR` 或 `~/.local/share/opencode` | `opencode*.db` | SQLite，`descriptor.rs:166-171, 240-247` |
| `gemini` | `~/.gemini/tmp` | `*.json` | `descriptor.rs:152-155, 248-255` |
| `grok` | `~/.grok/sessions` | `**/summary.json` | `descriptor.rs:158-161, 256-263` |
| `reasonix` | `~/.reasonix/projects` | `**/sessions/*.jsonl` | `descriptor.rs:164, 274-281` |
| `dsh` | 无（自供源，插件上报） | — | `descriptor.rs:265-273` |

`ConversationMeta.project_path`（= 会话 cwd）的来源逐 CLI 不同，且**都是「从转录内容/文件名里读出来的路径字符串」**：

- claude-code：首条 user 行的 `cwd` 字段（`adapters/claude_code.rs:178-180`）；
- codebuddy：行内 `cwd`，缺失时**从父目录名反解**（`canonical` 反解，`adapters/codebuddy.rs:116-127`）；
- codex：`session_meta.payload.cwd`（`adapters/codex.rs:218-232`）；
- pi：首行 `cwd`（`adapters/pi.rs:128-131`）；
- reasonix：**文件名反解** `projects/<sanitized>/sessions/*.jsonl` → `unsanitize_project_dir`（`adapters/reasonix.rs:74-92`）。

### 1.4 cwd 不在任何已知项目根下的转录会怎样

三种命运，取决于适配器有没有 scoped discovery，而**不存在任何兜底桶**：

1. **scoped adapter（claude-code / pi / omp / reasonix）**：`discovery_roots_for` 返回的目录列表里没有它的编码目录
   ⇒ 文件**从不被解析**，缓存里没有这一行 ⇒ 历史列表、搜索、`get_resume_command` 全部看不到它。
   注意 `Some(roots) if roots.is_empty()` 会**提前返回**（`manager.rs:388-393`），连「根不存在」的告警都不会有。
2. **非 scoped adapter（codebuddy / codex / gemini / qoder / grok / opencode）**：文件被解析并进缓存，
   但 list/search 时被 `matches_project_path` 判假 ⇒ **对用户不可见**（但仍留在缓存与磁盘索引里，
   且能被 `agent_id:native_id` 直接打开，见 Q3）。
3. **任何情况下都没有「未归属 / 其他」桶**：
   - 历史列表只按**日期**分组（`src/features/conversation/utils/groupByDate.ts:38-60`），没有项目分组；
   - `ConversationMeta.projectPath` 在 wire 上存在（`src/shared/types/session.ts:14`），但 UI 不显示、不聚合；
   - `search_conversations` 接受可空 `project_path`（`commands.rs:216-230`、`manager.rs:933`），
     **却没有任何 UI 调用方**（`conversationApi.ts:98` 导出后无人使用）。
   ⇒ 今天没有任何入口能列出「不属于任何已知单元」的会话。

### 1.5 侧栏 live sessions 怎么判定「属于当前项目」

- 快照是**全量**的，后端不分单元：`list_live_sessions`（`live_sessions/commands.rs:41`）直接回
  `Registry::snapshot_view()`（`live_sessions/view.rs:105-117`）。历史注释明确写了删掉 `workspace` 参数的
  理由：后端不要第二套「单元归属」判据（`commands.rs:32-40`）。
- 过滤在**前端 selector**，判据是 **`workspaceKey` 字符串等值**：
  `sessionsByUnit`（`src/shared/selectors/liveSessionSelectors.ts:126-140`）按 `session.workspaceKey` 分组，
  key 由后端铸造 `entry.workspace.key()`（`live_sessions/view.rs:57-58` → `WorkspaceSession::key()`）。
  这不是路径前缀，而是**注册过的地址 key**（`projectId\0worktreePath`）。
- 渲染只在「已知单元行」上发生：项目主仓行 `WorkspaceSession.of(project.id, null).key`
  （`features/project/components/ProjectGitSection.tsx:39, 48`）＋ `git worktree list` 给出的 worktree 行
  （`features/project/components/WorktreeList.tsx:41-44`）。**没有匹配单元行的会话不会被渲染**，
  也没有「其他 / 未归属」分组。
- `SessionEntry.workspace` 是**地址**，`SessionEntry.cwd` 是**执行根**，两者不是一回事
  （`live_sessions/entry.rs:69, 73`）。注册时由命令层一次性给齐（`terminal/commands.rs:47-51`、
  `live_sessions/wiring/pty.rs:151-166`）。

---

## Q2 — 是否已有「路径 → 项目身份」的映射

### 2.1 身份模型（三形态，封闭）

- `ProjectId` —— 品牌 string，铸造点唯一在 api wrapper（`src/shared/utils/workspaceRef.ts:36-40`）。
- `WorkspaceSession` = `{ projectId, worktreePath | null }`，`key = {projectId}\0{worktreePath}`，
  与 Rust `WorkspaceRef::key()` 逐字对齐（`workspaceRef.ts:44-100`；`common/git/workspace_ref.rs:100-113, 380-400`）。
- `WorkspaceRef`（后端解析后的身份 + 根）：`common/git/workspace_ref.rs:143-186`，
  `resolve(project_id, project_root, worktree_path, target)` 是**唯一**构造入口（`:196-236`）。

### 2.2 有没有「一个函数：路径 → 所属项目」？

**没有。** 现存三条相关但都不等价：

| 入口 | 做什么 | 差在哪 | 位置 |
| --- | --- | --- | --- |
| `project::lookup::environment_for_path` | 拿路径与 `Project.path` 做**宽松相等**（分隔符归一 + 去尾斜杠），返回该项目的 `ProjectEnvironment` | 只认**项目根本身**，不认任何 worktree；`~/.neeko/worktrees/<name>` 永远匹配不上 | `src-tauri/src/project/lookup.rs:14-27`；组合根包装 `app_state.rs:303-330` |
| `WorkspaceRef::resolve` / `resolve_workspace_target` | `(projectId, worktreePath)` → 已验证身份的 ref + 根 | 方向相反：要先有项目身份 | `common/git/workspace_ref.rs:196`、`app_state.rs:441-447` |
| `UnitScope::owns` / `deepest_root` | 「这条 cwd 属于哪个**单元根**」（最深根胜出） | 需要先拿到一个已解析的 `WorkspaceRef` 才能算兄弟根；不是全局反查 | `common/git/unit_scope.rs:130-190` |

`environment_for_path` 的生产调用者**只剩一处**：团队 v15 旧行（`app/team_executor.rs:110-113`），
且文档明确承认它对 worktree 无效（`team/execution.rs:396-415`、`app_state.rs:270-296`）。

### 2.3 worktree 是不是项目的「一等 workspace」？

**是「一等执行单元」，但不是「可全局登记的实体」**：

- worktree 清单是**按项目现算**的：`git worktree list --porcelain` → 身份渲染
  （`common/git/operations/worktree.rs:119-135, 146-156`），前端由 `project.git_info.worktrees` 提供
  （`ProjectGitSection.tsx:35`）。**没有** worktree 注册表、没有 `WorktreeInfo` 持久化类型
  （全仓 `grep WorktreeInfo` = 0 命中）。
- 「工作树归属哪个项目」只能**通过项目去问 git**，不存在反向索引。前端也没有
  `findProjectByWorktreePath` 之类的函数（`src/features/project`、`src/shared/store` 均无）。
- 因此：一条 cwd = `~/.neeko/worktrees/<name>` 的会话，**今天没有任何机制**把它归到父项目；
  唯一能表达这件事的是 `WorkspaceRef`（`project_id` + `worktree_path`），而它必须由**调用方先提供**。

### 2.4 红线 12（禁止用路径字符串再派生身份）在本链路上的违规点

按「是不是用未注册的路径字符串替代了 `WorkspaceSession`/`WorkspaceRef`/`UnitScope`」判：

1. **`ConversationsPanelWrapper.tsx:51`** —— `projectPath = worktreePath ?? project?.path ?? null`。
   History 面板拿**裸路径**当范围；同一份「我在哪个单元」的信息在别处是 `activeWorkspaceSession(projectId)`
   （`shared/store/workspaceStore.ts:191-196`）。这是本链路上最直接的一次字符串再派生：
   空串 / 空白与 `null` 的归一规则在这里被绕开了一次。
2. **`useConversationList.ts:121-122, 147, 151-152, 224`** —— 把同一个字符串分别送进 `list` 与 `scan`，
   于是「列哪个单元」与「扫哪个目录」被同一个字符串绑死；切到另一个单元时它才变。
3. **`conversation/manager.rs:1322-1336` `matches_project_path`** —— 「会话属于项目」的判据是纯字符串前缀；
   它既不认 `WorkspaceRef`，也不认「最深根胜出」。与 `UnitScope::owns`（`unit_scope.rs:130`）构成**两套并存**的归属判据。
   文档也承认这是历史并存形态（`unit_scope.rs:5-10` 点名 `conversation::matches_project_path`）。
4. **`conversation/scope.rs:41-82`** —— 把路径字符串编码成目录名（claude/pi/omp 三种字母表）。
   这是**读外部存储**时不可避免的编码，但它同时被用作「哪个项目的会话」的发现判据，
   于是「编码正确」等价于「身份正确」。
5. **`conversation/adapters/codebuddy.rs:120-127`、`reasonix.rs:74-92`** —— 从**目录名反解**出 cwd
   （`unsanitize_project_dir`），身份由文件系统布局字符串重新构造（不可逆、有损）。
6. **`agent/team/execution.rs:417-423` `environment_source`（`LegacyPath`）** —— 只在空 `project_id`
   （v15 旧行）时退回路径前缀反查项目；新写入路径已改按 id 精确查表（`team/bootstrap.rs:85`）。
7. **反向的同一类缺陷（不是路径派生，而是身份缺失）**：`app/team_executor.rs:196-200`
   把成员/队长的登记地址硬编码成 `WorkspaceSession::of(team_project_id, None)` = **项目主仓**，
   而 `cwd` 是团队根（可能是 worktree）。于是 `entry.cwd` 与 `entry.workspace` **互相矛盾**：
   按 `UnitScope::owns(entry.cwd)` 该是 worktree 单元，按 `workspaceKey` 却被登记在主仓行下。
   `entry.cwd` 的文档还写着「它也是『这个会话属于哪个单元』的判据（`UnitScope::owns`）」
   （`live_sessions/entry.rs:70-73`）—— 生产代码里**没有任何地方**这样用它（`UnitScope::owns` 的
   生产调用者只有 `manager.rs:595`，判的是**会话转录的** cwd，不是 live 条目的 cwd）。

---

## Q3 — 一条「团队成员会话」在这些域里长什么样

### 3.1 生命周期（谁起进程、cwd 是哪、登记到哪）

```
TeamLaunchPanel        team root = useActiveWorkspaceRoot(activeProjectId, projectPath)
                        （features/agent-team/components/TeamLaunchPanel.tsx:71-73）
start_team             projectId = activeProjectId，projectPath = 工作区根（可能是 worktree）
                        （hooks/useStartTeam.ts:43-52）
team::execution         cwd = workspace_cwd(team.project_path, member.workspace)  (execution.rs:426-428)
                        队长与成员走**同一条**执行路径（execution.rs:168-170）
app/team_executor       起 PTY：argv 形态 + extra_env（身份 env/凭证/配置目录）(team_executor.rs:196-215)
                        登记地址 = WorkspaceSession::of(team_project_id, None)  (team_executor.rs:196-200)
terminal/manager        每个 PTY 都注入 NEEKO_SESSION_ID = PTY id（manager.rs:183-185）
team/identity/env       另注入 NEEKO_TEAM_ID / NEEKO_TEAM_MEMBER_ID（identity/env.rs:12-16, 46-54）
```

### 3.2 conversation 域会看到什么？

- **会看到转录文件**（CLI 自己写）：路径 = 该 CLI 的编码规则(团队成员进程的 cwd)。
  例如 claude-code 队长跑在 `~/.neeko/worktrees/feat-team` ⇒
  `~/.claude/projects/-Users-tomgs--neeko-worktrees-feat-team/*.jsonl`（编码规则见 `scope.rs:41-48`）。
- **能否被发现取决于 History 面板当刻的 scope**：
  - 面板在**主仓**（`projectPath = 项目根`）⇒ scoped adapter 的编码前缀不含该 worktree ⇒ **扫不到**（Q1.4 情形 1）；
    非 scoped adapter 扫到了也会被 `matches_project_path` 滤掉（情形 2）。
  - 面板在该 **worktree 单元**（`worktreePath` 激活）⇒ 编码正确，能看到。
  也就是说：**团队会话在 History 里的可见性，取决于另一个维度（当前激活单元）的偶然取值**，
  而不是「它属于这个项目」。
- 队长/成员进程的 cwd 与 `team_project_path` 一致时（团队建在主仓上），链路正常 —— 这是今天唯一的健康形态。

### 3.3 能否把「团队成员会话」与普通用户会话区分开？哪些属性活过重启？

| 候选属性 | 存在哪 | 活过重启？ | 证据 |
| --- | --- | --- | --- |
| `NEEKO_TEAM_ID` / `NEEKO_TEAM_MEMBER_ID` env | 成员 PTY 进程 env → 子进程继承 → hook 上报 `hints` | ❌ 进程死了就没了；hook 只在活着的进程里触发 | `team/identity/env.rs:46-54`；`agent/hooks/ingest/attribution.rs:13-14, 255` |
| `NEEKO_SESSION_ID` env | 每个 PTY 注入 | ❌ 同上 | `live_sessions/env.rs:17`；`terminal/manager.rs:185` |
| hook 事件里的 `agent_session_id` | 事件载荷 | ❌（事件是瞬时的），但**被两个域落库** | `agent/hooks/ingest/event.rs`；见下表 |
| `team_member.terminal_id`（PTY id） | team 库 `team_member` 列 | ✅ | `team/store.rs:69, 541-571`；`types.rs:203` |
| `team_member.agent_session_id`（原生 id） | team 库 `team_member` 列（v20→v21） | ✅ | `team/store.rs:295-302`；`types.rs:195-201` |
| `session_cursors` 行（`session_id`=PTY id、`project_id`、`worktree_path`、`cwd`、`native_session_id`、`has_user_input`、title） | `agent_sessions.db` | ✅ | `agent/chat/session_store.rs:268-286`；持久化投影 `live_sessions/cursor.rs:84-113`，恢复 `:126-159` |
| 转录文件里的会话内容 | CLI 自己的存储 | ✅ | `descriptor.rs` 表 |

**结论**：今天唯一**持久**且能表达「这条会话是某团队某成员的」字段是 `team_member.terminal_id` /
`agent_session_id`；**live_sessions 行本身不携带任何团队身份**（这与 `liveness-and-launch.md` §1.2 一致），
而 `session_cursors` 也不带团队列（`session_store.rs:268-286`）。

### 3.4 有哪些候选「link」把历史/实时条目连回团队成员？

今天**实际存在**的连接点（都是在运行时按值匹配，没有一条是显式外键）：

1. **`(agent_id, native_session_id)`** —— 三处同时持有：
   - `live_sessions.SessionEntry.native_session_id`（`entry.rs:81-89`，来源 `HookEvent.agent_session_id`，
     由 `registry.record_native_session_id` 写入，**不受事件种类限制**，且**只写第一次**：`registry.rs:410-429`）；
   - `team_member.agent_session_id`（`manager.rs:1090-1117`，来源同一字段，但只在 4 类事件上）
     —— 4 类 = `turn_completed` / `approval_requested` / `input_requested` / `session_failed`
     （`team/observe.rs:87-101`）+ 归因必须通过（`observe.rs:110-140`）；
   - `conversation` 缓存的 `ConversationMeta.id = "{agent_id}:{native_session_id}"`
     （`manager.rs:1284`）。
   ⇒ 由此产生两条已有链路：
   - live → conversation 标题回落：`cached_title_for_native(agent_id, native_id)`（`manager.rs:1029-1050`，
     调用点 `live_sessions/wiring/hooks.rs:161`、`:197-206`）；
   - team → conversation tab：`conversationIdOf(agentId, agentSessionId)` → `data.kind === 'conversation'`
     的 tab（`src/app/dock/wrappers/TeamPanelWrapper.tsx:102-125`；判据函数 `memberTerminal.ts:81-90`；
     spec `.trellis/spec/backend/team-domain.md:920-940`）。

2. **PTY 会话 id**：`team_member.terminal_id` ↔ `live_sessions.session_id` ↔ `session_cursors.session_id`。
   这是侧栏「打开会话」那条路（`TeamPanelWrapper.tsx:83-92` → `openExistingTerminalTab`）。
   `archive_member` 会清 `terminal_id`（spec `team-domain.md:936-938`），此后只剩 `agent_session_id`。

3. **团队根路径字符串**：`team.project_path` 与转录的 `cwd` 相等 —— 但今天**没有任何代码**用它做归属
   （团队域不读 conversation 缓存；conversation 域不认识 team）。

4. 不存在的连接：`ConversationMeta` 没有团队/成员字段（`src/shared/types/session.ts:3-33`）；
   `SessionView` 没有团队字段（`live_sessions/view.rs:26-52`）；`HookEvent` 有 team hints 但只在瞬时消费，
   不落任何 conversation 行。

### 3.5 一个必须知道的实现事实：冷缓存不能按需重扫

`team-domain.md:941-947`（§9a.5）声称 `session_file_path` 在缓存未命中时会**按需重扫该 agent**，
并点名两个测试 `opening_a_conversation_with_a_cold_cache_scans_on_demand` /
`a_missing_conversation_says_it_was_not_found_on_disk`。

**代码里没有这段实现，也没有这两个测试**（全仓 grep 无命中）：

- `ConversationManager::session_file_path`（`manager.rs:749-758`）只读内存 cache，未命中直接
  `Context("Conversation not found in cache")`；
- `get_messages`（`manager.rs:760-793`）、`get_resume_command`（`manager.rs:968-999`）、
  分页入口 `load_transcript`（`manager.rs:712-746`）都走它；
- 磁盘索引的 hydrate 只挂在 `list_conversations` / `search_conversations` 两个命令上
  （`conversation/commands.rs:118`、`:219`），**不在** `get_conversation_messages` 上
  （`commands.rs:143-160`）；
- 前端冷启动打开只会吞掉错误并渲染空正文（`src/features/conversation/hooks/useConversationDetail.ts:17-24`）。

后果：团队成员「查看记录」走的正是 `agentId:nativeId` 直开（不经列表），
**只有在同一进程里先打开过一次 History 列表（触发 hydrate / scan）才可能成功**；
否则失败面是「历史会话 tab 空白」，与用户报的「找不到会话」是同一族症状。
这是 spec 与实现之间的真实漂移，**不是本任务要修的产品行为，但会直接影响验收判据怎么写**。

---

## Q4 — History 的 resume / attach 行为

### 4.1 点一条历史条目

1. `ConversationPanel.handleView`（`components/ConversationPanel.tsx:104-110`）→ `onOpenConversationTab(meta)`
   → `ConversationsPanelWrapper.handleOpenConversationTab`（`:167-187`）：
   建一个 `kind: 'conversation'` 的 tab，`scope = { kind:'workspace', session: activeWorkspaceSession(currentProjectId) }`，
   `data.onResume = handleResumeConversation`。**只读查看器**，不建终端。
2. 查看器里的 Resume 按钮 → `handleResumeConversation`（`ConversationsPanelWrapper.tsx:59-101`）：
   - `getAgent(meta.agentId)` → `getResumeCommand(meta.id)`（命令 `get_resume_command`，`commands.rs:269`）；
   - 空 ⇒ toast「This conversation does not support native resume」；
   - 非空 ⇒ `buildResumeTaskCommand(agent, resumeCmd)` = `<command> <args…> <resumeArgs…>` 的 shell 拼接
     （`src/shared/utils/agentCommand.ts:51-56`）；
   - `createTaskTerminal(currentProjectId, { agentId, taskCommand })`（`ConversationsPanelWrapper.tsx:97`）
     → `createTerminalTabIn(activeWorkspaceSession(projectId), …)`（`terminal/api/taskTerminal.ts:49-92`）
     ⇒ tab 落在**当前激活单元**的 tab 空间，PTY 直接执行 `taskCommand` 字符串。
3. 另一条「恢复为 Agent Chat」：`handleChatResumeConversation`（`:104-125`）→ `openAgentChatTab(studio 地址, { resumeConversationId, resumeNativeSessionId })`。

### 4.2 侧栏 live 会话的「点回来」

`useActivateSession`（`features/live-sessions/hooks/useActivateSession.ts:29-55`）三级降级：

1. 映射键命中（`tab.data.ptySessionId` / `sessionId`）⇒ 激活；
2. 键丢了 ⇒ 认领孤儿 tab 并补键；
3. 无 tab ⇒ `recreateSessionTab`（`utils/sessionTabFactory.ts:23-58`）：
   - 进程还活着 ⇒ `attachSessionId` 接回同一 PTY；
   - 已结束 ⇒ `resumeFromSessionId` + `live_session_resume_command`（`commands.rs:157-168`）
     取原生恢复 args ⇒ `buildResumeTaskCommand` ⇒ 新 PTY，并 `adopt_live_session` 继承旧身份。

**注意**：这条路也会 `setActiveWorkspace(workspace.projectId, workspace.worktreePath)`
（`useActivateSession.ts:34`），而团队成员行的地址是**主仓**（`team_executor.rs:197`）
⇒ 点一次成员会话会把激活单元切到主仓，之后的 History 面板 scope 也跟着变成主仓路径。

### 4.3 有没有「带额外 env / argv 恢复 CLI 会话」的通用能力？

**前端没有；后端有，但只有团队域能用。**

- IPC `create_terminal_session` 明确不暴露 argv / env：
  `argv: None, extra_env: Vec::new()`（`terminal/commands.rs:63-67`），注释写明
  「团队成员会话由团队域的执行层自己构造 `TerminalLaunch`」。
- 前端 task 终端只能给一条 `taskCommand` 字符串（`terminal/api/taskTerminal.ts:24-47`），
  `TerminalOptions` 里没有 env 维度。
- 后端 `TerminalLaunch { argv, extra_env, … }`（`terminal/launch.rs`）+ `TerminalRegistration`
  （`live_sessions/wiring/pty.rs:78-86`）是完整的「带地址 + argv + env 起会话」能力，
  目前唯一生产调用者是 `app/team_executor.rs:196-215`。

⇒ **可复用的是一个「后端内部端口」，不是一个前端入口。** 团队域要「按原生 id + 身份 env 恢复」，
今天只能在后端做（就像 spawn 成员那样）；前端路径只能拼命令行字符串，无法注入 `NEEKO_TEAM_*`。

---

## 这批事实隐含的最硬约束（不含方案）

1. **范围表达本身有两套判据，且 History 用的是弱的那套。**
   `ListScope::Project` 是「裸路径字符串前缀」（`manager.rs:1322`），`ListScope::Unit` 才是「注册地址 + 最深根」
   （`unit_scope.rs:130`）。任何「按项目身份归属历史会话」的改动，都必须先决定
   **是让 History 改用 `Unit`（换 key），还是在 `Project` 里引入项目身份** —— 不能两者都留着：
   同一份「属于哪个项目」有两个答案时，前端必须再挑一次（正是 `commands.rs:98-102` 那段注释要消灭的形态）。

2. **扫描期的编码前缀 + 列表期的字符串前缀，必须一起改，否则症状不对称。**
   scoped adapter（claude-code / pi / omp / reasonix）的缺失发生在**发现期**（文件根本没进缓存），
   非 scoped adapter 的缺失发生在**过滤期**（进了缓存但被滤掉）。只改一端会得到
   「有的 CLI 能在其他项目里被搜到、有的不能」——比现在更难诊断。

3. **`~/.neeko/worktrees/<name>` 不在项目根的编码前缀里，这是设计而非缺陷。**
   `path_guard.rs:8-9` + `unit_scope.rs:11-15` 都写明默认布局「落在项目之外」。
   因此「让父项目看见 worktree 的会话」不可能靠字符串前缀扩展实现（会退化成
   「任何同名前缀的目录都算」）；必须有一个**登记事实**把 worktree 归到项目（今天只有 git 能回答，
   且只能按项目去问：`worktree.rs:119-135`，全仓没有反向索引）。

4. **live 行的身份与 cwd 已经不一致，且这件事是「共享的」而不是局部 bug。**
   `team_executor.rs:197` 把所有成员/队长登记到主仓地址，而 `cwd` 是团队根（可能是 worktree）。
   任何「用 cwd 重新归属 live 行」的修法都会与前端 `workspaceKey` 等值分组
   （`liveSessionSelectors.ts:126-140`）冲突；任何「改注册地址」的修法都会移动 tab 空间
   （`createTerminalTabIn` 按 key 落 tab），并影响 `useActivateSession` 的
   `setActiveWorkspace` 副作用。两边必须同一个决定。

5. **native id 的所有权是「多处、不同门槛、不同覆盖语义」。**
   - live：每个 hook 事件都写，**只写第一次**（`registry.rs:410-429`）；
   - team：只对 4 类事件写，**不同值会覆盖**（`manager.rs:1090-1117`）；
   - conversation：id 即 `agent:native`（`manager.rs:1284`），一旦 native id 变了就是另一条历史。
   ⇒ 「按原生 id 恢复」的前提是「谁是这条会话 native id 的所有者、语义是首写还是最新写」必须先定死；
   现状是三处三套，且 `--resume` 会带来新 native id（`live_sessions/cursor.rs:161-170` 已记录这个事实）。

6. **`agentId:nativeId` 直开历史是一条已有但不可靠的路。**
   它绕过列表范围（好事：与项目 scope 解耦），但后端**只在内存 cache 命中时**才能定位文件
   （`manager.rs:749-758`，与 spec §9a.5 相反）。所以「团队成员的会话能被打开」这件事今天不成立为契约 ——
   任何以「能打开历史」为验收的改动，必须同时决定**冷缓存如何定位转录文件**
   （按 agent 全量重扫？按 cwd 编码？按 file_path 索引？），否则验收会在「先开过 History」这类时序上飘。
