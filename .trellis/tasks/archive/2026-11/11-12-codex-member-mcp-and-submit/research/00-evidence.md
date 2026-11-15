# 现场证据（2026-11-12，团队 `test` / `tm_1a1ce32490b`）

两个病灶都不靠推理，全部来自落地数据。按「证据 → 结论」排列，实现时逐条可复查。

## 现象 1：成员在干活，板上永远「待认领」

### 1.1 板子没撒谎：后端从未收到 t2 的认领

```sql
-- ~/.neeko/neeko.db
select id,state,owner,claimed_at,reclaim_count from team_task where team_id='tm_1a1ce32490b';
-- t1|done|pi-arch@tm_…|1794461017668|0
-- t2|pending|<null>|<null>|0
-- t3|pending|<null>|<null>|0
-- t4|pending|<null>|<null>|0

select kind,count(*) from team_event where team_id='tm_1a1ce32490b' group by kind;
-- claim=1  （只有 t1）
```

`pi-arch` 的会话转录（`~/.neeko/team/<team>/pi-arch_<team>/sessions/--…/2026-11-12T05-23-08-415Z_01a1ce35-….jsonl`）
显示它 claim 了 t1、写完架构文档就 `TurnCompleted`，**从未** claim t2/t3/t4。
所以「板子不更新」不是快照/刷新问题。

### 1.2 真正的缺口：codex 成员的 `.mcp` 工具面**根本没连上**

`~/.codex/sessions/2026/11/12/rollout-…-01a1ce36-776d-75d2-…jsonl`（codex-ui）与
`…-776d-7f61-…jsonl`（codex-core）里，模型整轮反复 `tool_search`：

```
tool_search_call {"query": "neeko-team MCP task_list task_claim task_update team_status"} → tools: []
tool_search_call {"query": "task_list"} → tools: []
tool_search_call {"query": "task_list task_claim task_update team_send", "limit": 20} → tools: []
…（同转录取证 5 次，全部空；同轮里 mcp__codex_tui 那个 server 的工具能搜到）
```

模型自述：「团队工具没有出现在工具检索中」。→ codex 进程里 `neeko-team` 这个 MCP server
不可用，`task_claim / task_update / team_send` 一个都调不到，只能靠 shell 干活。

### 1.3 为什么不可用：门的 403

应用访问日志（`~/.neeko/neeko.log`）在 codex 成员启动后 1 秒：

```
13:23:57.529  POST /team/mcp -> 200     （codex-core spawn）
13:23:57.850  POST /team/mcp -> 200     （codex-ui   spawn）
13:23:58.416  POST /team/mcp -> 200     （codebuddy  spawn）
13:23:58.858  WARN [http] auth gate rejected request to /team/mcp
13:23:58.859  POST /team/mcp -> 403
13:23:58.861  WARN [http] auth gate rejected request to /team/mcp
13:23:58.861  POST /team/mcp -> 403      ← codex 两个成员各一次，之后就再没请求过
13:24:03.655… POST /team/mcp -> 200 ×3  ← codebuddy 的 initialize 序列
```

门的凭证提取器只有一种形态：

```rust
// src-tauri/src/agent/team/boot.rs:111
let gate = Arc::new(AuthGate::with_shared_hashed_tokens(
    token_set,
    vec![Arc::new(HeaderToken { name: TOKEN_HEADER })],   // = "x-neeko-team-token"
));
```

而 codex 那一行准入事实走的是**唯一被实测证明能发出去的鉴权通道** ——
`bearer_token_env_var`（`Authorization: Bearer <token>`）：

```rust
// src-tauri/src/agent/team/admission.rs（codex 行）
mcp_argv: &[
    "-c", r#"mcp_servers.neeko-team.url="{{url}}""#,
    "-c", r#"mcp_servers.neeko-team.bearer_token_env_var="{{token_env}}""#,
],
```

**下发的鉴权形状（Bearer）与门认的形状（自定义头）不一致 ⇒ 恒 403 ⇒ rmcp 直接
`Transport channel closed` ⇒ server 被丢弃 ⇒ 工具面不存在。**

旁证（本机实测，argv 形状本身没问题）：

```
$ codex -c 'mcp_servers.neeko-team.url="http://127.0.0.1:39311/team/mcp"' \
        -c 'mcp_servers.neeko-team.bearer_token_env_var="NEEKO_TEAM_TOKEN"' mcp list
neeko-team  http://127.0.0.1:39311/team/mcp  NEEKO_TEAM_TOKEN  enabled  Bearer token
```

pi 成员同一轮 `task_claim` 成功，因为它走 `--header x-neeko-team-token={{token}}`（与门一致）。

## 现象 2：codex 的消息停在 TUI 输入框里不提交

### 2.1 代码层面的事实（codex 0.167.0 源码）

- `codex-rs/tui/src/tui.rs:256` → `execute!(stdout(), EnableBracketedPaste)`：codex **开了** bracketed paste。
- `codex-rs/tui/src/bottom_pane/paste_burst.rs`：
  - `PASTE_BURST_CHAR_INTERVAL = 8ms` / `PASTE_BURST_MIN_CHARS = 3`：快速连续的字符流被判成**粘贴**。
  - `PASTE_ENTER_SUPPRESS_WINDOW = 120ms`：粘贴之后这段时间内的**回车按「粘贴里的换行」处理**。
  - `newline_should_insert_instead_of_submit()` = `is_active() || now <= burst_window_until`。
- `PasteBurst::clear_after_explicit_paste()`：把 `active` / `buffer` / `burst_window_until`
  一起清空 —— 这是**显式粘贴（Event::Paste）之后回车必然提交**的机器判据。

### 2.2 我们的投递形态

`src-tauri/src/agent/team/delivery.rs`：`emit(text)` → `sleep(150ms)` → `emit("\r")`。

150ms 只是**发起侧**的间隔：两次 `emit` 都只是往事件循环投递，真正落到 PTY 的顺序与
间隔取决于监听器被唤醒的时刻（主线程忙时两者会被背靠背处理）。一旦回车落进
`burst_window_until`（120ms）以内，codex 就把它当换行 → **正文留在输入框**，与用户看到的
一模一样。这是概率性故障，与「偶尔出现」吻合。

### 2.3 结论

不要靠加大间隔（时序耦合、仍然可能被事件循环吃回去）。用 codex **已开启**的
bracketed paste 把正文声明成一次显式粘贴：`\x1b[200~ <text> \x1b[201~`，随后单独回车。
显式粘贴会清掉 burst 窗口，回车因此确定性地提交。
