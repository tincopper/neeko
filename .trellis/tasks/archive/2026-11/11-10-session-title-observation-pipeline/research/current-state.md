# 调研：会话标题为什么对 claude / codebuddy / qoder 三源整体失效

> 结论先行：这不是三个 adapter 的 bug，而是**标题方案把「事实」与「观测通道」耦合**后的三个投影。
> 三个 CLI 共享同一条 Claude 兼容 hook 面，也就是共享同一个结构性缺口。

## 1. 现象

侧栏会话列表里，claude / codebuddy / qoder 的会话没有标题；历史上「拿不到标题就不列表」的
取舍（`liveSessionSelectors.ts:103`）进一步把缺标题放大成「会话不见」。

## 2. 证据（本机实测，2026-11-10）

### 2.1 标题只有两条路，两条对这三源都断

```
live_sessions/wiring/hooks.rs:114  project()
  ├─ event.topic() 有值            → TitleSource::Native
  └─ 无 topic 且尚无真标题         → conversation 缓存回落（cached_title_for_native）

conversation/manager.rs:991        cached_title_for_native(agent_id, native_id)  ← 只读内存缓存
conversation/commands.rs:110,201   该缓存仅在 list_conversations / search_conversations 时 hydrate
```

即：**开机后没打开过 History，回落必然 miss**；而 agent TUI 终端的首条输入被后端判负
（`report_terminal_input` 对 `agent_id = Some` 恒传空串），所以 hook topic 是唯一实时源。

### 2.2 hook topic 对三源恒为 null

```js
// agent/hooks/templates/neeko-report.mjs:129  —— 只认 Codex 系的字段名
const topic =
  firstLine(input.session_title) ||
  firstLine(input["thread_name"]) ||
  firstLine(typeof firstInput === "string" ? firstInput : null) ||
  null;
```

```rust
// agent/hooks/targets/entries.rs:29  —— 三源共享，只有 3 条事件
pub static CLAUDE_COMPAT_ENTRIES: [HookEntry; 3] = [PermissionRequest, Stop, StopFailure];
```

Claude 规范里唯一携带 prompt 的事件是 `UserPromptSubmit`（载荷字段 `prompt`），**未安装**。

实测：

```
$ python3 -c 'import json;print(list(json.load(open("~/.qoder/settings.json"))["hooks"]))'
['PermissionRequest', 'Stop', 'StopFailure']      ← 与 codebuddy 相同；无 UserPromptSubmit
$ # ~/.claude/settings.json 的 UserPromptSubmit 属于 Superset/orca，不是 Neeko
```

### 2.3 缓存回落对 qoder / codebuddy 结构性落空

| CLI | adapter 读取 | 实际落盘（本机） | 实际格式（实测首行） |
| --- | --- | --- | --- |
| qoder | `~/.qodercli/projects/*.jsonl`（`adapters/qoder.rs:26`，目录不存在） | `~/.qoder/projects/<sanitized-cwd>/<uuid>.jsonl`（与 `<uuid>/` 目录同级） | Claude 同形 jsonl；头部是 `workspace-directories` / `runtime-config` / `worktree-state` 三行元数据，**无 `title` 字段**，`timestamp` 只从 `runtime-config` 起有 |
| codebuddy | `~/.codebuddy/sessions/*.json`（`adapters/codebuddy.rs:28,35`，目录为空） | `~/.codebuddy/projects/<sanitized-cwd>/<uuid>.jsonl`（单文件 11–14MB） | **不是** Claude 同形：`{"id","timestamp","type":"message","role":"user","content":[{"type":"input_text","text":…}]}`，需走 `adapters/content_blocks.rs` 的块提取 |
| claude | `~/.claude/projects/**/*.jsonl` ✅ | 同左 ✅ | Claude jsonl；首条 `type:"user"` 在本机是 `<local-command-caveat>` 注入 |

磁盘索引（`~/.neeko/conversation-index.json`）的实况即结论：

```
Counter({'pi': 358, 'opencode': 255, 'claude-code': 161, 'grok': 136,
         'codex': 127, 'omp': 114, 'reasonix': 21, 'codebuddy': 2})   ← qoder 0 条
codebuddy 两条的标题都是兜底串：'codebuddy 111d0e39' / 'codebuddy 01a12ab7'
claude-code 161 条里 11 条标题是 '<local-command-caveat>…'，2 条是 'claude'
```

### 2.4 claude 的标题质量另有一处结构性缺口

claude adapter 的标题优先级是 `custom-title > ai-title > summary > agent-name > 首条 user 消息`
（`adapters/claude_code.rs:86-118`）。本机当前 Claude Code 版本**不再写** `summary` / `ai-title` /
`custom-title` / `agent-name` 条目：

```
$ grep -h -o '"type":"\(summary\|ai-title\|custom-title\|agent-name\)"' ~/.claude/projects/*/*.jsonl | sort | uniq -c
（空）
```

于是落到「首条 `type:"user"` 消息」，而它在本机是 harness 注入：

```
<local-command-caveat>The command below was run directly in Claude Code, ...</local-command-caveat>
```

`conversation::normalize` 的 `HIDDEN_BLOCKS` 不含 `local-command-caveat`，抑制前缀只查
`# agents.md instructions` / `<instructions>` ⇒ 该串**通过了标题判据**（这就是索引里那 11 条噪声）。
对照：同一份 normalize 在预览路径会剔除 harness 注入消息 ⇒ 同一事实两套判据。

## 3. 知识重复的现状（本方案的度量对象）

| 落点 | 内容 |
| --- | --- |
| `agent/hooks/targets/entries.rs` | 每个 CLI 报哪些事件 |
| `agent/hooks/templates/*`（4 个模板 + 1 shim） | 每个 CLI 的载荷字段名与 topic 提取链 |
| `conversation/adapters/*.rs`（10 个 `parse_meta`） | 每个 CLI 的存储布局 + 标题优先级 |
| `conversation/normalize.rs` vs `live_sessions/title/{judge,native,prompt}.rs` | 两套「这串字配不配当标题」 |
| 前端 3 处兜底：`conversationTabTitle.ts:15`、`SessionListRow.tsx:56`、`ConversationItem.tsx` | 空标题时各自编一个 |

→ 「怎么拿到标题」这件事目前有 **5×N** 个副本，任一处漂移即静默丢标题（qoder 丢全部、codebuddy 丢内容）。

## 4. 代码落点索引

- 身份：`agent/builtin/providers.rs`（`id` 字面量）、`agent/hooks/targets/data.rs:96-133`（`source` + `dir`）、
  `conversation/adapters/registry.rs`（adapter 注册）、`agent/hooks/ingest/validation.rs`（路由白名单）
- 判据：`live_sessions/title/judge.rs:37 admit`、`entry.rs:62 TitleSource`、`should_upgrade`
- 回落：`live_sessions/wiring/hooks.rs:114`、`conversation/manager.rs:991`
- 历史列表：`conversation/manager.rs:41 resolve_title`（P2 标题 → P3 首条用户消息 → `agent <id8>`）
- 侧栏可见性：`src/shared/selectors/liveSessionSelectors.ts:69,103`

## 5. 相关规范（实现前必读）

- `.trellis/spec/backend/conversation-adapter.md`（§4.3.1 file_pattern 与嵌套扫描、§4.3.2 存储与解析陷阱）
- `.trellis/spec/backend/agent-hooks-domain.md`（`InstallShape`、模板契约、内容寻址标记）
- `.trellis/spec/unit-test/real-source-determinism.md`（真实源只承诺 `≥`；夹具探针的断言口径）
- 根 `AGENTS.md` 红线 15（语言/CLI 差异必须落在数据）、红线 17（禁止影子副本）、红线 5（Event 名常量化）

## 6. 假设与验证状态（2026-11-10 实施后回填）

| # | 假设 | 状态 |
| --- | --- | --- |
| 1 | 三家 CLI 的提交 prompt 事件载荷含 `prompt` 字段 | **真机已验**（2026-11-10，用户手工确认标题按预期出现）。自动化仍不可达（需登录态）；字段缺失的退化路径安全：`topic` 为 null ⇒ 只剩占位标签，不报错 |
| 2 | qoder 的 `runtime-config` 行稳定存在 | **不再依赖**：`started_at` 取自首条 user 消息时间戳（Claude 同形解析），无该行也从 `timestamp` 得到 |
| 3 | 放宽标题门后侧栏噪声是否可控 | **已定案并由真机验证**：可见性 = `hasUserInput` + 有真标题（占位不算），**不看回合数**。「打开 tab 不出行、提交指令拿到标题就出行」符合预期；占位标签只用于 tab / 历史列表 |

### 实施中新确认的两条事实

- **Qoder 就是 Claude 格式**：行形态 `{"type":"user","message":{...},"timestamp":...}` + `ai-title`
  （`aiTitle`）—— 因此 `QoderAdapter` 现在**委派** `ClaudeCodeAdapter`，不再有第二份解析器。
  真机 `~/.qoder/projects/**/*.jsonl` = 43 个文件（旧实现扫 0 条）。
- **CodeBuddy 不是 Claude 同形**：`role` / `content` 在顶层、无 `message` 包装，另有
  `ai-title` / `reasoning` / `function_call(_result)` / `session-meta` 行；内容块仍走
  同一张 `content_blocks` 方言表（`input_text` 已在别名表里）。真机 17 个 jsonl。

两份历史缺陷的共因：adapter 的 `session_root` / 格式假设**从未对着真实落盘复核**，而
「扫到 0 条」是合法结果 —— 这正是 R7（观测健康度）要堵的洞。
