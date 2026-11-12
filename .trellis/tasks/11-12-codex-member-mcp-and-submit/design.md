# design — codex 成员的两条断链

> 证据（SQL / 日志 / codex 源码坐标）见 `research/00-evidence.md`。
> 本文件只写「改成什么形状、为什么是这个形状、边界在哪」。

## 0. 一句话

两条断链，都是**声明与实现的形状不一致**：

| # | 声明 | 实现 | 后果 |
| --- | --- | --- | --- |
| 1 | 下发给 codex 的鉴权形状是 `Authorization: Bearer <token>`（`bearer_token_env_var`） | 团队 MCP 门只认 `x-neeko-team-token` | 首个 `initialize` → 403 → rmcp 关传输层 → 工具面整体不存在 |
| 2 | 投递协议假定「正文与回车分开两笔」就够 | codex 的 paste-burst 把快的字符流判成粘贴，并把窗口内的回车当换行 | 消息停在 codex TUI 输入框，永不提交 |

两处都**不是**「再多写一个分支」的事：第 1 条的判据是「门接受准入表宣传的每一种鉴权形状」，
第 2 条的判据是「提交形态是 per-CLI 数据」（红线 15 同族）。修法都是把「同一事实的第二份
写法」消掉，而不是各加一个 `if`。

## 1. 断链 1：门与下发的鉴权形状

### 1.1 事实

- 团队成员 token 的 header 名是**单一常量** `mcp::protocol::TOKEN_HEADER`
  （`x-neeko-team-token`），`mcp_config_json()`（JSON 形态的客户端：claude-code /
  codebuddy / qoder / pi）与门都用它 ⇒ 这些成员今天正常。
- codex 的准入行走 `bearer_token_env_var`（该行 `unverified` 里写明：`http_headers` 形态
  「parses but was never proven to be sent」）⇒ codex 发 `Authorization: Bearer <token>`。
- 门（`agent/team/boot.rs:111`）只装了一个提取器 `HeaderToken { name: TOKEN_HEADER }`
  ⇒ codex 恒 403。实测日志里正是两次 403（`research/00-evidence.md` §1.3）。

### 1.2 形状

1. **新增凭证提取器** `BearerToken`（`src-tauri/src/server/gate.rs`，与 `HeaderToken` 并列）：

   ```rust
   /// `Authorization: Bearer <token>` —— 只认这一种拼法（大小写敏感、单空格）。
   ///
   /// 为什么不做宽容解析（`bearer` / 多空格 / 大小写不敏感）：这里不是给人用的输入框，
   /// 是**我们下发的配置**的回声。宽容一条谁也没写过的形状，等于给「另一条鉴权路径」
   /// 开一个没人会去审计的缝。
   pub struct BearerToken;

   impl CredentialExt for BearerToken {
       fn extract<'a>(&self, headers: &'a HeaderMap) -> Option<Cow<'a, [u8]>> {
           let value = headers.get(header::AUTHORIZATION)?.to_str().ok()?;
           value.strip_prefix("Bearer ").map(|t| Cow::Owned(t.as_bytes().to_vec()))
       }
   }
   ```

   注意：**它不比较**，只提取。恒定时间比较仍然只有 `AuthGate::authorize` 里那一处调用点
   （既有护栏 `constant_time_comparison_has_exactly_one_call_site` 因此不受影响）。

2. **门的构造收敛成一处置**：

   ```rust
   // mcp/server.rs：凭证形状清单的唯一实现（门与 handler 共用）
   pub(crate) fn team_credentials() -> Vec<Arc<dyn CredentialExt>> {
       vec![
           // JSON 配置形态的客户端（claude-code / codebuddy / qoder / pi）
           Arc::new(HeaderToken { name: TOKEN_HEADER }),
           // codex 的 `bearer_token_env_var`
           Arc::new(BearerToken),
       ]
   }

   // agent/team/boot.rs：门的唯一构造点
   pub(crate) fn team_gate(tokens: SharedTokenSet) -> AuthGate {
       AuthGate::with_shared_hashed_tokens(tokens, server::team_credentials())
   }
   ```

   `boot()` 改成 `Arc::new(team_gate(tokens.clone()))`，行为其余部分零改动。

   **为什么清单落在 `mcp::server` 而不是 `boot`**（初稿的缺口，评审时补）：这个端点有**两道**
   鉴权关卡 —— 门的中间件回答「能不能进来」，handler 的 `authenticate` 回答「进来的是谁」
   （header token → sha256 → 主体表）。只改门会得到**更糟**的失败形态：403 变成
   `HTTP 200 + JSON-RPC unauthorized`，rmcp 仍然丢弃 server（工具面仍然不存在），而访问日志
   上那次请求看起来是成功的。清单放在 server（handler 侧）是因为它在 handler 里有直接消费者，
   `boot` 与 handler 都引它 ⇒ 两侧不可能再漂。护栏测试
   `a_bearer_only_request_resolves_the_same_principal` 钉住「门放行的形状必须能解析出主体」。

3. **护栏测试**（`boot.rs` 的 `#[cfg(test)]`）：

   - `the_team_gate_accepts_both_advertised_shapes`：同一 token 明文，构造
     `SharedTokenSet::new(vec![hash(token)])`，断言 `x-neeko-team-token: <token>` 与
     `authorization: Bearer <token>` **都放行**，`authorization: Bearer <错>` 与无头 **都拒绝**。
   - `the_team_gate_rejects_everything_when_the_set_is_empty`：空集合恒拒（既有结构性保证，
     在**新形状**上再断言一次 —— 空集合 + Bearer 是最容易被「顺手放宽」的组合）。
   - 变异验证（AC2）：删掉 `Arc::new(BearerToken)` 那一行，第一条必须红。

4. **广告 ⟺ 接受**：把「能写进成员配置的鉴权形状」与「门接受的形状」绑在一起。
   本轮的机器判据就是上面两条测试 + 注释里点名的两侧落点：
   - 形状来源：`admission.rs` codex 行（`bearer_token_env_var`）/ `execution::mcp_config_json`
     （`TOKEN_HEADER`）。
   - 接受方：`team_gate()`。
   不新增抽象（YAGNI）：今天只有两种形状，做成 `enum AdvertisedAuth → BearerToken/HeaderToken`
   会把「渲染配置」与「鉴权」耦成第三种真相 —— 两份列表的漂移风险并没有消失，只是换了位置。

### 1.3 为什么不选另外两条路

| 备选 | 否决理由 |
| --- | --- |
| 把 codex 改成 `http_headers`（`x-neeko-team-token`）注入 | 该形状**从未被实测证明会发送**（准入行 `unverified` 原文）。用一个未验证的缺口去补一个已证实的缺口 = 把静默失败留在原地。 |
| 给 codex 走 `ConfigDir` 用 `codex mcp add` | `codex mcp add` **没有** header 选项（准入行注释），写出来的 server 无凭证 ⇒ 仍然 403，只是换了个位置。 |

### 1.4 安全影响

- 可接受的凭证形状从 1 种变成 2 种，但**token 空间不变**（同一份 SHA-256 集合、同一处
  恒定时间比较）。没有降级、没有「本组免鉴权」路径。
- `Authorization` 是本进程**团队 listener** 上的头；hooks listener 是另一个门实例
  （不同端口、不同 token 空间），不受影响。

## 2. 断链 2：Pty 投递的提交形态

### 2.1 事实（codex 0.167.0 源码，见 `research/00-evidence.md` §2.1）

- codex TUI 开了 bracketed paste（`tui.rs:256 EnableBracketedPaste`）。
- `paste_burst.rs`：≤8ms 间隔的连续字符流被当成粘贴；粘贴活动之后 120ms 内的回车
  **按「粘贴里的换行」处理**（`newline_should_insert_instead_of_submit`）。
- 显式粘贴（`Event::Paste` → `handle_paste`）会调 `clear_after_explicit_paste()`：清空
  `active` / `buffer` / `burst_window_until` ⇒ **之后的回车必然是提交**。

### 2.2 我们的现状为什么中招

`deliver_via_pty` 的 `sleep(150ms)` 只是**发起侧**的间隔：两次 `emit` 都往事件循环投递，
落到 PTY 的真实间隔取决于监听器被唤醒的时刻（主线程忙时背靠背处理）。回车一旦落进
120ms 窗口就被当换行 ⇒ 概率性「停在输入框」。**加长间隔不是修法**：它把一个正确性
依赖换成另一个时序常数，且在最忙的时候（最容易背靠背的时候）最不安全。

### 2.3 形状

1. **per-CLI 数据**（`admission.rs`）：新增字段

   ```rust
   /// 把一行字变成**一次提交**的形态 —— 每 CLI 的实测事实（红线 15 同族）。
   ///
   /// 为什么是数据：裸正文与 bracketed paste 对**不认这个转义的 TUI** 是灾难
   /// （它会把 `ESC[200~` 当字面量插进输入框）。所以这里没有默认值可偷懒，
   /// 只有「实测过能用的那一行」才填非 Plain。
   pub pty_submit: PtySubmit,
   ```

   ```rust
   // delivery.rs（投递层的值类型；admission 引它，依赖方向 admission → delivery）
   #[derive(Clone, Copy, Debug, PartialEq, Eq)]
   pub enum PtySubmit {
       /// 正文一笔（literal）→ 间隔 → `\r` 一笔。既有形态，逐字节不变。
       Plain,
       /// `ESC[200~` + 正文 + `ESC[201~` 一笔 → 间隔 → `\r` 一笔。
       /// 显式粘贴会清掉 codex 的 paste-burst 窗口，回车因此必然提交。
       BracketedPaste,
   }
   ```

   填表（`ADMISSIONS`）：`codex → BracketedPaste`，其余行 `Plain`（**逐字节不变**，AC3/R3）。
   依赖方向：`admission → delivery`（数据层引投递层的值类型）。反向（`delivery → admission`）
   会让投递层为了填一个 shape 去查 CLI 表 —— 那正是「按 agent 名分支」的入口。

2. **纯函数改造**（`delivery.rs`）：

   ```rust
   pub fn pty_write_plan(message: &str, submit: PtySubmit) -> PtyWritePlan
   pub fn route(channel: WorkerChannel, submit: PtySubmit, message: &str) -> DeliveryRoute
   ```

   - `PtyWritePlan` 的结构**不变**：仍然是 `text` / `enter` / `gap` 三字段，`writes` 仍然是
     恒两笔（固定长度契约不破）。`BracketedPaste` 只改变 `text` 的**字节内容**：
     `b"\x1b[200~" + 正文 + b"\x1b[201~"`。正文里的 `\n` 仍原样保留（粘贴内的换行是内容）。
   - `enter` 仍是单字节 `\r`；`gap` 仍是 `PTY_WRITE_GAP`（对 codex 已不再承担正确性，
     保留它是为了让「两笔」这条协议对所有 CLI 一致）。
   - `Mcp` / `None` 两支**与 submit 无关**，继续 `Unsupported` + 可行动理由。

3. **调用点**（`app/team_executor.rs::deliver`）：成员行在手，shape 由准入表给：

   ```rust
   let submit = admission::pty_submit_for(&member.agent_id);
   let plan = match delivery::route(member.channel, submit, message) { … };
   ```

   `pty_submit_for(agent_id)` 在 `admission.rs`（唯一查表点，未登记的 id → `Plain`：未登记
   的 id 不可能是成员，而 `Plain` 与改动前逐字节相同 —— 失败方向是「不变」）。

4. **测试**（`delivery.rs`）：

   - `bracketed_paste_wraps_the_body_and_keeps_enter_separate`：`text ==
     b"\x1b[200~hi\x1b[201~"`，`enter == b"\r"`，`gap == PTY_WRITE_GAP`。
   - `plain_plan_is_byte_identical_to_the_original_protocol`：`Plain` 的 `text ==
     b"hi"`（既有断言仍在，不削弱）。
   - `the_wrapper_survives_multiline_and_utf8_bodies`：多行 + 中文正文只被包裹，不改写。
   - `only_the_pty_channel_gets_a_write_plan`（既有）扩一维：两种 submit × 三档通道。
   - `admission` 侧：`codex_uses_bracketed_paste_and_everyone_else_is_plain`（AC3）。

### 2.4 为什么不选另外三条路

| 备选 | 否决理由 |
| --- | --- |
| 把 `PTY_WRITE_GAP` 从 150ms 加到 400ms | 时序耦合。emit → 事件循环 → 监听器 的延迟没上界（主线程忙时会背靠背），加常数只是把概率压低。 |
| 一次写 `text + "\r"` | 模块文档记录的实测反例：部分 TUI 会丢掉或误解释同批回车。 |
| 改 codex 用户配置 `disable_paste_burst` | 碰用户全局配置（本域明确禁止），且对**别的** codex 会话产生副作用。 |

## 3. 边界与红线自查

| 红线 | 本改动 |
| --- | --- |
| 1（统一执行接口） | 不新增进程调用；codex 的 argv 仍在 `core::exec` 之外（既有 PTY 路径不变） |
| 3（阻塞隔离） | `deliver_via_pty` 仍只在 `spawn_blocking` 里调（调用点未变） |
| 4 / 5（IPC 大小 / event 名） | 零新增 IPC；`terminal-input-{id}` 名字仍来自 `common::terminal::events` |
| 6 / 7 / 9（命令薄 / if-let 深度 / mod.rs） | 不碰命令层与 `mod.rs` |
| 14（声明即实现） | 门的声明（接受形状）与实现（提取器）在同一 diff；`bearer_token_env_var` 这条声明首次有消费点；门与 handler 共用 `mcp::server::team_credentials()` |
| 15（差异落在数据） | `pty_submit` 是 `AgentAdmission` 字段；通用模块仍无 `agent_id` 分支（既有护栏 `per_cli_facts_live_only_in_the_table` 继续生效） |
| 17（禁止影子副本） | 提交形态不缓存到成员行 / 不落库（`agent_id` 已在成员行，形态由准入表推导） |

## 4. 兼容性与回滚

- **无数据库迁移**：不新增列、不改 `team_member` 持久化事实（`pty_submit` 不进库）。
- **既有成员行**：`agent_id` 已在库里 ⇒ 改动对老团队同样生效，无需重建团队。
- **对 pi / claude-code / codebuddy / qoder**：`Plain` ⇒ 字节与今天完全一致。
- **回滚**：单 commit 可回退；两处改动互不依赖（门 / 投递），可分别回退。

## 5. 风险与已知缺口

| 风险 | 处置 |
| --- | --- |
| bracketed paste 在某些终端复用器下需要上游开启 | 下发的客户端是我们起的 PTY（xterm.js + portable-pty 直连），不经过 tmux/mosh；AC6 手工验证覆盖 |
| codex 升级后改写 paste 判据 | 本轮把它降为「不再承担正确性」：显式粘贴是协议行为，与 120ms 窗口无关 |
| 其它 CLI 也有 paste-burst（只是还没撞上） | `pty_submit` 已是数据；发现即填表 + 补 AC3 的测试行，不改投递层 |
| 403 只落一条 warn，用户看不见 | 本轮**不改**（Non-Goal）。修复后若仍不可达，同一行日志仍是最快入口 |
| 只修门、忘了 handler 的 `authenticate` | 已由 `team_credentials()` 单点共用 + `a_bearer_only_request_resolves_the_same_principal` 钉住（这是初稿的真实缺口） |
