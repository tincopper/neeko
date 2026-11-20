# 技术设计：会话标题的事实层 / 观测层分离

## 1. 一句话架构

**标题是「用户意图的一次投影」，不是一个 CLI 文件的字段。** 因此设计分两层：
稳定的事实层（阶梯 + 唯一判据 + 永不空的身份标签）与易腐的观测层（每个 CLI 一行数据：
转录布局 + prompt 事件 + 字段名），两层之间只通过 `TitleCandidate` 传递**原始候选**。

```
  观测层（N 行数据，会腐坏）                    事实层（稳定，唯一判据）
  ┌────────────────────────────┐              ┌─────────────────────────────┐
  │ User      ← 用户改名 IPC    │──┐           │                             │
  │ Prompt    ← Neeko 发出的 prompt │          │  admit(candidate) → Option<String>
  │ CliNative ← hook topic       │──┼─────────▶│  should_upgrade(current,incoming) │
  │ Prompt    ← hook prompt 字段  │           │  持久化到会话行（P2）        │
  │ CliNative ← 转录文件解析      │──┘           │  缺则 Placeholder(身份标签)  │
  └────────────────────────────┘              └─────────────────────────────┘
```

## 2. 边界

- **在范围内**：`live_sessions::title`（判据/阶梯）、`agent::hooks`（数据表 + 模板 + ingest 投影）、
  `conversation::adapters`（只产出原始候选）、前端三处标题兜底。
- **不在范围内**：终端渲染、侧栏布局、CLI 配置的写入门（信任哈希）、通知域。
- **不变量**：任一会话的 wire `title` 非空；`TitleSource::Placeholder` ⟺ 无真标题（两者仍一一对应，
  但 Placeholder 现在**有文本**）。

## 3. 数据流

### 3.1 实时（推送，权威）

```
PTY 子进程 (NEEKO_SESSION_ID)
  → CLI hook (UserPromptSubmit / Stop / PermissionRequest)
  → shim（按 descriptor 取字段，零 per-CLI 分支）
  → POST /hook/{source}  →  ingest → HookEvent { title: prompt 首行 }
  → wiring::hooks::project() → registry.upgrade_title(Native | Prompt)
  → SessionView.title（非空，最差是 Placeholder 身份标签）
```

关键改动：`TitleSource::Prompt` 现在是**真的一级**（用户自己敲的字），不再只有纯 shell 走它；
hook 的 `prompt` 与 Codex 的 `input-messages` 归一为同一候选来源。

### 3.2 历史（拉取，只富化）

```
CLI 转录文件 (descriptor.transcripts)
  → adapter.parse_title_candidates() → [CliNative(raw), Prompt(raw), …]   ← 不再自行判决
  → admit() 逐级取第一个非 None
  → ConversationMeta.title（历史列表）/ 会话行快照（P2 落库）
```

失败模式：布局漂移 → 0 文件 → 由 P2 的健康度报警，而不是静默降级为兜底串。

## 4. 契约

### 4.1 候选与判据（事实层）

```rust
// live_sessions/title/candidate.rs
pub enum TitleCandidate<'a> {
    User(&'a str),           // 用户改名：不套清理
    CliNative(&'a str),      // CLI 自述的会话名 / AI 标题
    Prompt(&'a str),         // 首条用户意图行（含纯 shell 命令行）
}

// live_sessions/title/judge.rs —— 全仓唯一判据（已有，扩展分派）
pub fn admit(candidate: TitleCandidate<'_>, agent_id: Option<&str>) -> Option<String>;
pub fn should_upgrade(current: TitleSource, incoming: TitleSource) -> bool; // 不变
pub fn placeholder_label(agent_name: &str, project_label: Option<&str>, ordinal: u32) -> String;
```

`placeholder_label` 是 R2 的唯一产出点：`"Claude Code · neeko"` / `"Claude Code #3"`。
它**不猜测主题**，只用身份事实，因此不会与红线 17（影子副本）冲突：它就是该会话的显示身份。

### 4.2 AgentDescriptor（身份脊柱）

```rust
// conversation/descriptor.rs（或被 common::agent 吸收，见 §5 D1）
pub struct AgentDescriptor {
    pub id: &'static str,                     // "claude-code"（provider + adapter + registry 同一 id）
    pub hook_source: Option<&'static str>,    // "claude"
    pub config_dir: fn() -> Option<PathBuf>,  // ~/.claude
    pub transcripts: Option<TranscriptSpec>,
    pub prompt_hooks: &'static [PromptHookSpec],
}

pub struct TranscriptSpec {
    pub root: fn() -> Option<PathBuf>,
    pub pattern: &'static str,                // "**/*.jsonl"
    pub layout: TranscriptLayout,             // ClaudeLike | CodebuddyLike | Sqlite | …
}

pub struct PromptHookSpec {
    pub native_event: &'static str,           // "UserPromptSubmit"
    pub field: &'static str,                  // "prompt"
}
```

派生关系（每一处只读这张表，不再有第二份字面量）：

| 消费者 | 现在读什么 | 改成读什么 |
| --- | --- | --- |
| `agent/hooks/targets/data.rs` | 自带 `source` + `dir` 字面量 | `descriptor.hook_source` / `config_dir` |
| `agent/hooks/ingest/validation.rs` | 由 HOOK_TARGETS 派生 ✅ | 不变（自动跟上） |
| `conversation/adapters/registry.rs` | 10 个 adapter 各自 `session_root`/`file_pattern` | `descriptor.transcripts` |
| `agent/hooks/templates/*` | 各自硬编码 topic 字段链 | `descriptor.prompt_hooks[].field`（shim 只认一份内联表，见 §5 D2） |
| 设置页 / 夹具清单 | 手写 | 由表枚举 |

### 4.3 前端（渲染层）

```ts
// 唯一职责：渲染后端给的字符串。删除兜底。
conversationTabTitle(meta)  → meta.title              // 不再 ?? agentId ?? 'Conversation'
SessionListRow              → session.title            // 不再 fallbackLabel（aria-label 用 title）
ConversationItem            → meta.userTitle ?? meta.title  // 保留 userTitle 覆盖，但不再容忍空
```

`isListedSession` 的新判据（去标题依赖）：

```ts
export function isListedSession(s: SessionView): boolean {
  return s.hasUserInput && hasFinishedFirstTurn(s);
}
```
（`titleSource === 'native' | 'user'` 的直通分支随之删除：标签永远非空，无需特例。）

## 5. 关键技术决策

- **D1 descriptor 的归属**：放 `common/agent/descriptor.rs`（`AgentConfig` 同域）而不是
  `conversation/`。理由：hook / conversation / 设置页三方都要读，放在任一侧都会让另一侧反向依赖；
  它是「Agent 的静态事实」，与运行期数据无关。`AgentConfig`（可被用户覆盖的运行配置）保持独立，
  descriptor 是编译期常量，不被用户编辑。
- **D2 shim 是拷贝出去的实体文件**：模板里的字段链无法在运行时读 Rust 表，故 shim 内联一张
  `SOURCE_FIELDS` 表（数据），由 `templates/tests.rs` 与 `AgentDescriptor` 做**一致性测试**
  （Rust 表驱动断言：每个 `prompt_hooks.field` 必须在模板表里出现）。这保持红线 15 而不用引入 IPC。
- **D3 为什么 Placeholder 不空**：空串让「缺少观测」变成不可渲染状态，从而在 UI 层诱发假兜底。
  给它身份事实后，「没有主题」与「没有会话」不再混淆，`isListedSession` 也就不必背负可见性判决。
- **D4 不做模型摘要**：标题质量的上限由观测决定，不由生成决定；生成会把「丢观测」伪装成「有标题」
  （更难发现），与 R7 冲突。若将来要做，它是阶梯新增一级 + 单独的采样/缓存预算。
- **D5 缓存回落从「热路径查表」降级为「P2 的持久化快照」**：P1 先修好数据源（让回落至少可能命中），
  P2 再把「事件时刻落库」接上，最终删掉热路径上的跨域查表。

## 6. 兼容性

- wire 契约不变：`SessionView.title` 仍是非空 string；`titleSource` 枚举值不变（新增 `prompt` 用法，
  前端不读它做判断，只做调试）。
- 历史索引（`~/.neeko/conversation-index.json`）会保留旧兜底串，需要一次迁移：`version` 提升，
  旧条目在下次扫描时自然被覆盖（不做 backfill 写盘，避免把错误数据固化）。
- 已安装的 hook 是文件副本：改模板后必须提示用户重装（设置页的 installed 判定基于内容寻址标记，
  已在 `agent-hooks-domain.md` D13 定案，直接复用）。

## 7. 回滚

三步各自可回滚（P0/P1/P2 独立 commit）：

- P0 回滚：恢复 `isListedSession` 的标题前提 + 前端兜底（单文件，无数据迁移）。
- P1 回滚：descriptor 是新增模块，回滚 = adapter 恢复自带 `session_root`；
  hook 事件表多一条 `UserPromptSubmit`，回滚 = 删那一行 + 重装 hook（幂等）。
- P2 回滚：新增表列/快照字段按「缺列即旧行为」处理（读路径先判空），健康度可单独关闭。

## 7.5 实施修订（2026-11-10，与上面设计的差异）

1. **`PromptHookSpec` 未实现**：Claude 兼容三家的 prompt 字段名**相同**（`prompt`），
   再引一张 per-CLI 字段表就是给一个恒定事实加间接层（KISS）。改成两条护栏：
   「shim 不含任何原生事件名」（既有用例）+「hook 表与 descriptor 表的 `hook_source` 双向一致」。
2. **`TranscriptLayout` 枚举未实现**：qoder 实测是 Claude 同形 ⇒ `QoderAdapter` 直接**委派**
   `ClaudeCodeAdapter`（零新解析器）；codebuddy 是自家行形态 ⇒ 自己的解析器（`role`/`content`
   在顶层，块仍走 `content_blocks`）。布局差异因此落在「适配器实现」而不是一个 dispatch 枚举 ——
   只有真实出现的第二种形态才值得抽象，第三种出现时再抽（YAGNI）。
3. **`AgentDescriptor` 的 `transcripts.root` 是 `UnderConfig("…") | Elsewhere(fn)`**，
   不是「root 函数 + pattern」：把「与配置根同源」这条关系写进类型，才使 qoder 那类漂移
   不可能以「两次 home join」的隐形态出现。
4. **`Placeholder` 标签的组成部分**是 `agent slug · cwd 末段`（不是 agent 显示名）：
   显示名属于前端 `AgentConfig`（可被用户覆盖），后端只有 slug；行内 meta 已显示 agent 名，
   标题槽里重复它是冗余。
5. **M2 的「标题落库」发现本来已成立**（`set_title` / 权威事件都经 `finish → persist_entry`），
   故未新增列；M2 实际交付是「根不存在必须报错」+「真实样本探针」。

## 8. 待验证假设（实现第一步，先证伪自己）

1. 三家 CLI 的 `UserPromptSubmit` 载荷字段名（各抓一条真实载荷；Qoder 只保证结构同形）。
2. Neeko 自己发出的 prompt（chat / `prompt_args`）能否在**不依赖 hook**的情况下直接产出
   `TitleSource::Prompt`（若可以，R6 的最强形态成立，P1 优先级提高）。
3. `hasUserInput` 是否足以在放空标题门后挡住「空 tab 噪声」——用 P0 的回归快照验证。

详见 `research/current-state.md` §6。
