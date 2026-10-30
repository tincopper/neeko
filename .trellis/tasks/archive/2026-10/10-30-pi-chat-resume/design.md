# 设计：Pi 历史会话恢复为 Agent Chat（第一性原理推导）

> 需求与验收见 `prd.md`，执行序见 `implement.md`。本文只做技术设计。

## 0. 第一性原理：这个问题本质上是什么

把「历史会话 → 在 Agent Chat 里继续聊」拆到不可再分，只剩三件事：

| # | 事实 | 谁提供 | 现状 |
| --- | --- | --- | --- |
| 1 | **绑定** —— 一个活进程重新挂到**已存在**的原生会话状态上 | chat adapter 的 `resume()` | pi 缺失 |
| 2 | **回放** —— 该会话已有回合的只读渲染 | conversation 域（`getConversationMessages`） | 已可用 |
| 3 | **接续** —— 用户下一条消息路由到**同一个**进程 | `AgentChatManager`（`request_channel` + `owns`） | 已可用 |

三件事彼此正交。**会话状态的唯一权威在 agent 自己的存储里**（pi 的
`~/.pi/agent/sessions/**/*.jsonl`、opencode 的 SQLite）；Neeko 只持有一个**引用**
`nativeSessionId`，不复制、不解析、不重建状态。由此直接得到三条不可违的结论：

- **C1** 恢复能力是 **(agent, 传输)** 这条组合的属性：同一个 pi 在 rpc 传输下能恢复，
  在（假设的）其它传输下可能不能。它既不是 conversation 扫描器的属性（能不能从
  磁盘读标题/消息数），也不是「CLI 参数表里有没有 `--session`」。
- **C2** 因此「入口显隐」与「执行」必须消费**同一个事实**。当前 bug 的根因正是两个轴
  被混成一条：显隐读 conversation 侧 `meta.supportsResume`（= CLI 有 `--session`），
  执行走 chat 侧 `supports_chat_resume()`。
- **C3** Neeko 不得为了「更早报错」而去复刻 pi 的会话查找语义（自己扫
  `sessions/` 目录猜 id 是否存在）。那会造出第二份真相，pi 改布局就静默走偏。

## 1. 推论（结论来自约束，不来自偏好）

### 推论 1：能力只有一个真相，UI 从它派生

`AgentAdapter::supports_chat_resume()` 已经是 chat 侧唯一判据，且后端已有薄命令
`agent_chat_supports_resume`。前端因此**不应**新增任何本地规则（例如按 agentId 白名单），
只新增一个「查询 + 内存缓存」的门面，且避免每行一次 IPC。

> **实施修正（review 轮）**：本推论原本把能力称为「一个会话内不会变的静态事实」——
> 错了。它只是**对同一份 agent 配置**静态（由 `chat` / `chat_enabled` 决定），
> 而用户在设置里改 chat 传输并不需要重启。只按 `agentId` 做缓存键等于存了一份
> 与真相脱钩的副本（本任务要消灭的同一个形态）。现在的缓存键是
> `agentId + 启动签名`，且 hook 的依赖也用同一份签名 —— 两处都随配置变化重新派生。

### 推论 2：pi 的「不支持」是声明与实现脱节，不是能力缺失

- `ChatCapabilities.resume` 的契约明文是「`resume_id` 有真实值**且** `resume` 可用」
  （`capabilities.rs:82`），pi 已声明 `true` 并已实现 `resume_id()`（`session.rs:708`）。
- 实测 `pi --mode rpc --session <uuid>` → `get_state.sessionId` 相同、`messageCount: 55`。
  ⇒ 缺的只是 adapter 的一段 spawn 参数 + trait 覆写。
- 按红线 14 的判据，声明了却没人实现 = 静默功能缺失；所以这里**不能**靠把声明改成
  `false` 来「修好」—— 那会把已经可用的 `resume_id` 一起废掉（前端入口随之消失）。

### 推论 3：恢复必须静默启动（`prompt` 为空）

回放由 conversation 域负责；若在 `create/resume` 时把历史塞成 prompt，会双写、
双倍耗 token、且改变 agent 侧的会话内容（不可回滚）。`agent_chat_resume` 已把
`silent = true` 传给 `resolve_session_context`，`PiSession::start_with` 已按
`ctx.prompt.is_empty()` 跳过首轮 —— **复用同一条路径，不新增分叉**。

### 推论 4：参数顺序必须让适配器的 `--session` 排在用户参数之后

pi 对重复选项是**后写者胜**（`process.rs` 的 `launch_args` 文档记录了实测：
`--mode json --mode rpc` → rpc）。用户完全可能在 `AgentConfig.chat.args` 里写了
`--session <别的 id>` 或 `-c`（continue）。若适配器的 `--session` 排在前面，
user args 会**静默劫持恢复目标**：界面显示的是 A 会话历史，实际接续的是 B。
⇒ 恢复参数拼在 user args 之后、`--mode rpc` 之前（与现有 `launch_args` 同一条规则）。

### 推论 5：恢复后必须验证绑定到了**同一个**原生会话

`--session` 接受**部分 UUID**，匹配是有歧义的（0 或 1 个候选）。命中多个时 bin 可能
取第一个 ⇒ 静默落到错误的会话。绑定错误比失败更糟：用户以为在续写原会话，实际在
污染另一条会话的上下文。

⇒ `resume()` 在握手后比较 `PiSession::resume_id()` 与请求的 `native_session_id`，
不相等则 `cancel()` 回收进程并 `Err(AppError::NotFound)`。
**这一条不依赖自己解析存储**（C3）：比较的是 pi 自己回报的权威值。
顺带效果：`resume_id()` 目前在生产路径上没有任何消费者（只有测试在读），本改动给它
第一个真实消费者，而不是删掉它再让 `ChatCapabilities.resume` 悬空。

### 推论 6：失败必须「快且可归因」——错误信息来自进程真实原因

实测失败形态：`pi --mode rpc --session <不存在>` → **exit 1 + stderr
`No session found matching '<id>'`**。而当前进程层有两点把这条真相丢掉了：

1. `PiRpcProcess::spawn` 丢弃 stderr（`_stderr`）；
2. 读循环结束（stdout 关闭）时**不 settle pending**（只 log）。
   ⇒ 在途请求只能等 `AUX_TIMEOUT`(5s) 超时，报 `pi rpc command timed out after 5s`。
   **慢 5 秒，且原因错误。**

两个修正都是「让已有信号不被吞掉」，没有新增机制：

- 读循环结束 → `pending.clear()`（drop 掉 oneshot sender ⇒ `rx.await` 立刻 `Err`）；
- spawn 时保留 stderr 尾部（有界环形缓冲），握手失败时附在错误上。

这同时修好了 pi 的**所有**启动期失败（参数写错、auth 缺失、二进制版本不兼容），
不只是 resume —— 因为它们都走同一条握手。

### 推论 7：能力一致性由测试钉住，而不是靠人读代码

`chat_capabilities().resume` 与 `supports_chat_resume()` 是同一个事实的两处表达，
必须同源。测试断言二者相等，并且断言「位为 true ⇒ `resume()` 有覆写」（用不存在的
二进制：失败必须是 spawn 类错误，不能是 trait 默认的 `Unsupported`）。

## 2. 落点与契约（改动面）

### 2.1 Rust —— `src-tauri/src/agent/chat/adapter/pi_rpc/adapter.rs`

```rust
impl PiRpcAdapter {
    /// spawn 的唯一入口：`cmd[1..]` + `tail` 交给 `PiRpcProcess::spawn`。
    /// `tail` 是适配器契约参数（恢复用 `--session <id>`），必须排在用户 args 之后。
    async fn spawn_process(&self, ctx: &AgentContext, tail: &[&str]) -> Result<PiRpcProcess, AppError>
}

#[async_trait] impl AgentAdapter for PiRpcAdapter {
    async fn create(...)  => start_with(spawn_process(ctx, &[]))
    async fn resume(&self, ctx, native_session_id) => {
        let proc = self.spawn_process(ctx, &["--session", native_session_id]).await?;
        let session = PiSession::start_with(proc, ctx, self.chat_capabilities()).await?; // 握手失败已带 stderr
        ensure_bound_to(native_session_id, session.resume_id().as_deref())?;  // 推论 5
        Ok(Box::new(session))
    }
    fn supports_chat_resume(&self) -> bool { self.chat_capabilities().resume }
}
```

纯函数（可直接单测，无需进程）：

- `fn extra_args(cmd: &[String], tail: &[&str]) -> Vec<String>` —— 参数拼装与顺序；
- `fn ensure_bound_to(requested: &str, actual: Option<&str>) -> Result<(), AppError>`。

### 2.2 Rust —— `src-tauri/src/agent/chat/adapter/pi_rpc/process.rs`

- `spawn`：保留 stderr；后台 task 累积**有界**尾部（保留最后 ~2KB，避免病态输出涨内存）；
  `pub fn stderr_tail(&self) -> String`。
- `spawn_reader`：循环结束后 `pending.clear()`；错误文案改为
  `pi rpc: process ended before responding`（比 `response channel closed` 可读）。
- 新增 `fn append_stderr(err: AppError, tail: &str) -> AppError`（纯函数）：
  tail 为空则原样返回，否则 `AppError::Agent(format!("{err} — pi stderr: {tail}"))`。
- `PiRpcProcess::annotate(&self, err).await` = 取 `stderr_tail()`；**尾部为空且进程已结束
  时有界等待（≤300ms）stderr 排空**再取一次（stdout/stderr 两个读循环的调度顺序不保证，
  不等就会随机丢掉原因），最后交 `append_stderr`。

### 2.3 Rust —— `src-tauri/src/agent/chat/adapter/pi_rpc/session.rs`

- 把三段握手抽成 `async fn handshake(proc: &PiRpcProcess) -> Result<Handshake, AppError>`
  （`get_available_models` / `get_available_thinking_levels` / `get_state`），
  `start_with` 里 `handshake().await.map_err(|e| proc.annotate(e))?`。
  抽取理由：不改测试夹具的注入路径（`start_with` 仍是唯一入口），且 stderr 装饰只写一次。

### 2.4 前端 —— 新增 `src/features/agent-chat/utils/chatResumeSupport.ts`（审查轮修正：原定 `api/`）

```ts
/** agent 能否把原生会话恢复为 Agent Chat（唯一数据源：agent_chat_supports_resume）。 */
export function supportsChatResume(agentId: string): Promise<boolean>
// 每个 agent 一条缓存：{ signature, answer }；signature = f(chat, chat_enabled)，
// 从 agentStore（唯一配置读入口）现取 —— 配置一变就重查。失败缓存 false。
```

消费点两个（都只读这一个事实）：

- `ConversationsPanelWrapper`：`useChatResumableAgents(agents)` → `Set<string>`，
  经 `ConversationPanel` → `ConversationList` → `ConversationItem` 传
  `canChatResume?: (agentId: string) => boolean`；按钮同时要求
  `onChatResume && meta.nativeSessionId && canChatResume(meta.agentId)`。

  > **实施修正（review 轮）**：按钮**不**再嵌在 `meta.supportsResume === true` 里。
  > chat 恢复只需要「有原生会话 id + chat 侧能重新绑定」；CLI 能否 `--resume`
  > （`supportsResume`）是另一个轴，叠上去会让「chat 能恢复、CLI 不能恢复」的
  > agent 静默丢掉入口（与「按钮在、点了报错」同类的另一端）。两个按钮各按自己的
  > 真相显隐，`Resume` 仍只看 `supportsResume`（R3.4）。
- `useChatRestore.loadResumableList`：过滤条件由「有 `nativeSessionId`」改为
  「有 `nativeSessionId` **且** 该 agent 支持 chat 恢复」。

> 为什么门控放在 wrapper/hook 而不是 `ConversationItem` 内部：组件不得自行发起 IPC
> （与 `agentInputRegistry` 同一条分层理由），且一次查询要复用给整张列表。
>
> **为什么住 `utils/` 而不是 `api/`**：`api/` 的判据是「换掉传输层它是否仍成立」。
> 缓存、失效键（读 `agentStore`）、「查不到就隐藏入口」的失败口径都与 IPC 无关 ⇒ 领域策略。
> 放进 `api/` 会让「api = invoke 薄封装」这条判据失真（spec `api-layer.md` 原则 6）。

## 3. 恢复时序（成功路径）

```
ConversationsPanel ──opencode/pi 会话行点击──▶ tab(agent-chat, resumeNativeSessionId)
                                                    │
        useChatRestore effect: supportsAgentChatResume(agentId)?  ── 否 → 不建 tab（入口已隐藏）
                                                    │是
        restoreConversation(meta)
          ├─ getConversationMessages(meta.id) ──▶ messages（回放，只读）
          └─ resumeAgentChat(req, nativeSessionId)
                 └─ agent_chat_resume (Rust)
                      ├─ adapter.resume(ctx, nativeId) → spawn `pi … --session <id>` → 握手
                      ├─ ensure_bound_to(nativeId, get_state.sessionId)   ← 推论 5
                      └─ spawn_session_pipeline(cursor)  → manager 持有请求通道
        sessionIdRef = sid  → 用户下一条消息走 `agent_stream(sessionId)` 续聊分支
```

失败路径：`resume` 的任一环 `Err` → 前端 catch → `⚠ 恢复会话失败: <pi 真实原因>`（R2.3）。

## 4. 权衡与被否方案

| 方案 | 否掉的理由 |
| --- | --- |
| 前端按 `agentId` 白名单（只放 opencode/pi） | 造第二份事实，与后端漂移后立刻出现死入口（正是本次 bug 的形态） |
| 把 `chat_capabilities().resume` 改成 `false` 来「消除矛盾」 | 废掉已实现的 `resume_id`，入口整体消失（红线 14 的反向违约） |
| 自己扫 `~/.pi/agent/sessions/**` 预校验 id 是否存在 | 复刻 pi 的存储布局与作用域语义（C3），pi 改版即静默走偏 |
| 恢复时把历史塞进首轮 prompt | 双写 + 双倍 token + 污染原生会话，且不可回滚（推论 3） |
| 只加 `--session`，不做绑定校验 | 部分 UUID 歧义会静默落错会话（推论 5），比失败更糟 |
| 依赖 5s 超时来暴露失败 | 慢且原因错误；真实原因就在 stderr（推论 6） |
| 给 stderr 做完整日志聚合 / 上报 | YAGNI：只需握手失败的尾部，有界缓冲足够 |

## 5. 兼容性、风险与回滚

- **用户配置**：`AgentConfig.chat.args` 里已有 `--session`/`-c` 的配置会被适配器参数覆盖
  （后写者胜，符合「恢复目标由 UI 决定」的语义）。风险：用户依赖 `-c` 自动续接最新会话；
  该行为在**新建**会话路径不受影响（`create` 不带 tail）。
- **pi 版本**：`--session` 至少在 1.3.x 存在；若未来被移除，表现为 spawn 后握手失败，
  错误带 stderr（可归因），不会静默成功。
- **能力位收敛**：`supports_chat_resume()` 直接返回 `self.chat_capabilities().resume`，
  单一来源，未来新增传输只要填快照即可。
- **回滚粒度**：Rust（P1/P2）与前端门控（P3）各自独立可回滚；前端门控先落地也安全
  （此时 pi 入口被隐藏，不会出现死入口），故不要求与 P1 同批上。

## 6. 测试策略

| 层 | 用例 | 手段 |
| --- | --- | --- |
| 纯函数 | `extra_args` 顺序（tail 在 user args 之后）、`ensure_bound_to` 相等/不等/None | 直接断言 |
| 纯函数 | `append_stderr` 空 tail / 非空 tail | 直接断言 |
| 进程层 | 读循环结束立刻让在途请求失败 | `from_split` duplex：写完响应后关闭对端，断言 `< AUX_TIMEOUT` 报错 |
| 进程层 | stdout 先 EOF、stderr 迟到时 `annotate` 仍拿到原因 | 延迟写 stderr 后断言尾部被带上（删等待即红） |
| 会话层 | 握手失败时错误含 stderr 尾部 | `from_split` + 注入 tail（测试构造器） |
| 契约 | `caps.resume == supports_chat_resume()`；位 true ⇒ `resume()` 有覆写（不存在的二进制 → 非 `Unsupported`） | 直接断言 |
| 前端 | `supportsChatResume` 缓存（同 agent 同配置只 IPC 一次）、配置变更后重查、失败缓存 false、空 id 短路 | `vi.mock` invoke + 真 `agentStore` 快照 |
| 组件 | 不支持 agent 的行不渲染 chat 按钮；支持则渲染 | `@testing-library/react` |
| Hook | `loadResumableList` 过滤掉不支持的 agent | `renderHook` + mock 两个 api |
