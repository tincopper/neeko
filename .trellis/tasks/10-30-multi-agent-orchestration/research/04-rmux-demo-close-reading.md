# rmux demo launcher 精读（`demo-orchestration/launch.sh` + `CLAUDE.md`）

信源等级 **A**（原文逐行）· 2026-10-30

---

## 1. 量化：这份"编排 demo"里没有编排

| 构成 | 行数 | 占比 |
| --- | --- | --- |
| **终端窗口/几何/GUI 管道**（`open_terminal` / `macos_terminal_bounds` / `osascript` / `wt.exe` / PowerShell `MoveWindow` P/Invoke …） | **171** | **60%** |
| 会话启动（`new_agent_session`） | 9 | 3% |
| 清理（`kill-server` / `kill-session` / 删临时文件） | 10 | 3% |
| 其余（引号、检查、分支、launch 装配） | 97 | 34% |
| **合计** | **287** | |

launcher 里 `capture-pane` / `send-keys` / `wait` 出现 **0 次**。全部动作写在 `CLAUDE.md` 里，由 Claude 自己在运行时调。

⇒ **它 = 启动器 + 一份提示词。编排逻辑 100% 在 agent 脑内。**

---

## 2. 三处真该学（均来自 `CLAUDE.md`，不是脚本）

### 2.1 文本与 Enter 必须分两次写，中间留间隔

> 「**Always send text and Enter as two separate `rmux send-keys` calls. Some AI TUIs drop or reinterpret Enter when text and Enter arrive in the same input burst.**」

```bash
rmux send-keys -l -t codex:0.0 -- "Hi"
sleep 0.15
rmux send-keys -t codex:0.0 C-m
```

**直接影响 `WorkerChannel::Pty` 的实现**：一次 `write("text\n")` 在部分 TUI 上会丢 Enter 或误解释。
必须拆成 `write(text)` → ~150ms → `write(CR)`。

这条是本任务里**唯一无法从文档推导、只能实测得到**的知识。

### 2.2 literal 模式 + `--` 分隔

`send-keys -l` 让内容不被当作键名解析；`--` 终止选项解析。
成员之间传的消息可能包含 `C-m` / `Enter` / `-t` 这类字样，不做 literal 会被解释成按键。

### 2.3 读结果 = 限行的 scrollback 截取

```bash
rmux capture-pane -p -t codex:0.0 -S -120   # 最近 120 行
```

印证两点：① 无协议时"读结果"只能截屏（本质是猜）；② **必须限行**，否则 scrollback 会把载荷撑爆。
→ 支持 sentinel 通道的扫描器限长策略（8KB carry buffer / 2KB 单行）与这条同源。

---

## 3. 三处反证（证明本方案的判断是对的）

### 3.1 四个 CLI、四种"跳过审批"写法

```bash
codex  --dangerously-bypass-approvals-and-sandbox
gemini --skip-trust --approval-mode yolo
grok   --always-approve
claude --dangerously-skip-permissions --permission-mode bypassPermissions
```

它**必须**这么干，因为这一层没有 blocked 状态 —— 一遇审批就死锁。

**但同时产出一条设计项**：这是 per-CLI 的差异数据，必须落**插件数据**（红线 15 精神），
不能写成 `if agent == "claude"` 分支。→ `AgentConfig` 增 `approval_bypass_args`，
供 `approval_policy = Bypass` 时使用。

### 3.2 `sleep 0.8` / `sleep 1` 等窗口出现 / 等输入生效

没有状态层就只能靠 sleep。对比：`team_wait` 阻塞在语义状态上，不需要任何 sleep。

### 3.3 `new-session` 没有 `-c`（cwd 参数）

```bash
rmux new-session -d -s "$session" -n "$title" -x 120 -y 34 "$command"   # 无 -c
```

⇒ 四个 agent **共用 launcher 的 cwd**，同一个目录、无 worktree、无分支。
真并行时它们会互相覆盖。

这是「**冲突故事本质是 worktree 故事**」的实物证据，也说明这份 demo 只能演示、不能用于真实并行。

---

## 4. 两个真正的设计改进

### 4.1 `Pty` 通道的实现要求（新增）

```
send(member, text):
  1. 若 member.state == Awaiting → 拒绝（target_blocked），不写字节
  2. write_literal(text)            ← 不做键名解释
  3. sleep ~150ms
  4. write(CR)
  5. 落 audit（谁给谁发了什么摘要）
```

第 1 步与 herdr 的 `agent.prompt` 行为一致（目标 blocked 时不发输入）。
第 2–4 步来自本 demo 的实测经验。

### 4.2 协议 preamble 从「任务体」移到「skill 文件」

demo 的分工很清楚：
- **静态协议** → `CLAUDE.md`（谁是目标、怎么发、怎么读、别假装执行）
- **动态坐标** → `RMUX_DEMO_TARGETS` env

我们现在的设计把 `nonce` + sentinel 格式写进**每个任务体**，有两个坏处：
1. 任务体会被 `agent.prompt` 打进 pane ⇒ **整段回显进 PTY 字节流** ⇒ 抬高 sentinel 误匹配风险（§Sentinel P2）
2. 每个任务都重复一遍协议文本，prompt 膨胀

**改法**：复用 `resource_deployer` 既有的 **skills 部署**能力，给团队部署一份 `neeko-team` skill
（内容 = sentinel 格式、`task_claim`/`task_update` 用法、禁止假装执行）。任务体里只留
**nonce + task_id + 具体需求**。

顺带把「Do not simulate actions」这类护栏也放进 skill —— 但注意：**它仍是提示词级约束**，
真正的护栏必须是我们自己的状态校验（owner + state + 幂等），不能指望模型守规矩。

---

## 5. 一处架构级印证（比"后台跑"更有价值）

```bash
rmux -S "$SOCKET" ...              # 一组进程共享一个 socket/服务端
cleanup() { kill-session ×3; kill-server; }
```

`-S` 的价值不只是隔离，而是**一组进程拥有统一的生命周期边界** —— 整组一起建、整组一起销毁。

对 Neeko 而言，这比"关掉 App 后 agent 继续跑"更实用：
团队关闭时需要同时收拾 **N 个 PTY + N 个 worktree + N 份凭据**，
今天我们只能逐个收；有 daemon 就是一次 `kill-server`。

⇒ daemon 化的收益应表述为「**生命周期分组**」，而不是「持久化」。
（仍属 terminal 域议题，不并入本任务。）

---

## 6. 不要学的部分

| 不学 | 原因 |
| --- | --- |
| 60% 的窗口几何 / `osascript` / `wt.exe` / P/Invoke 管道 | Neeko 本身就是终端，这 171 行是纯 GUI 税 |
| 提示词里写死 target 列表（`RMUX_DEMO_TARGETS`） | 我们需要动态 `team_spawn` |
| `sleep` 当同步原语 | 有语义状态就不该 sleep |
| 靠提示词约束（"Do not simulate actions"）当护栏 | 护栏必须是结构性的（状态校验 + 幂等），不是劝模型 |
| `capture-pane` 当结果通道 | 这是猜；我们优先 MCP/sentinel，屏幕只作 blocked 兜底 |
