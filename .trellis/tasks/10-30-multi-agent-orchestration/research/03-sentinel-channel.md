# sentinel 通道：让 agent 在终端里输出结构化结果

提出人：tincopper（2026-10-30）· 结论：**成立，作为第三条准入通道（不是替代）**

形态：

```
NEEKO_RESULT <nonce> {"executionId":"...","status":"completed","summary":"..."}
```

即：不依赖 hook、不依赖 MCP，让 agent 把结果**打印到自己的 stdout**，Neeko 在 PTY 字节流里扫这一行。

---

## 1. 它为什么真有用

| 场景 | hook | MCP | **sentinel** |
| --- | --- | --- | --- |
| 有 hook 有 MCP（claude/qoder/codex） | ✅ | ✅ | 冗余/兜底 |
| 有 hook 无 MCP | 只有"完了"，没有"结果" | —— | ✅ **补上结果** |
| **无 hook 无 MCP**（`gemini` / `grok` / `reasonix`） | ❌ | ❌ | ✅ **唯一可行** |

本任务 R0 原本把 `gemini`/`grok`/`reasonix` 判死（无 `turn_completed` ⇒ 不允许当成员）。
有 sentinel 之后**这三家重新可当成员**，只是通道质量降级。

### 1.1 一个容易被忽略的性质：sentinel 同时是 L1 和 L2

```
hook  : L1（turn_completed）+ 另需一条路取结果      ← 两层两通道
MCP   : L2 一条（task_update(done, summary)）     ← 也自带 L1 语义
sentinel: L1 + L2 + 载荷，一条 in-band 消息        ← 一次给全
```

对 no-hook agent，这解决了"怎么知道它完了"和"它做了什么"两个问题 —— 代价是可靠性。

---

## 2. 五个必须处理的坑（in-band 的原罪）

in-band 意味着这条消息和终端里所有其他字节**共用一个信道**，所以会被污染。

### P1 模型不照做（advisory）
sentinel 是**指令级**要求，不是协议。agent 忘记、改写格式、或把 JSON 拆成多行都会让等待失效。

缓解：
- 任务体里把 sentinel 定义为**最后一行的硬要求**，给**可复制的确切模板**（含 nonce）
- `team_wait` 必须有 timeout，超时落 `Timeout{snapshot}` 而不是永久挂起
- 收到 `turn_completed` 但无 sentinel → 落 `Done{unverified}`（已有不变量）

### P2 prompt 回显 / 自触发（最容易踩）
- TUI 会把**用户/系统打进去的字**回显到屏幕 ⇒ 回显也进 PTY 字节流
- agent 自己 `echo` / `cat` / `grep` 到那段文字也会产生同样的行
- 若任务体是经 `agent.prompt` 打入 pane 的，**模板本身会被回显一遍**

缓解：见 §3（nonce + 状态校验），这是唯一可靠的解法。

### P3 换行 / ANSI 破坏 JSON
- **不是**问题：终端**软换行**（自动折行）不进字节流，长的物理行在字节层面是完整的
- **是**问题：agent 自己**硬换行**（部分 CLI 会在宽度处插 `\n`）、插入颜色转义码、`\r` 回退覆盖行首

缓解：
- 要求**单行紧凑 JSON**（无缩进），长度上限 2KB
- 扫描前剥离 ANSI（既有 `conversation/text.rs` 已有正则原语可复用）
- **解析失败静默忽略该行**，不要报"结果损坏" —— 否则回显的模板会天天报错

### P4 分片到达
`terminal/pump.rs` 按 16ms 合流 + 有背压，一条 sentinel 必然跨帧。

缓解：
- 有界 carry buffer（如 8KB），只在 `\n` 处切行，超界丢最旧
- **绝对不要无界累积** —— 该 pump 的历史事故是 WebContent 8 分钟膨胀到 5.2GB，红线 4 就是那次写的

### P5 幂等 / 重放
同一条 sentinel 可能出现两次（agent 重试），或 Neeko 重启后重扫 scrollback。

缓解：
- `executionId` 去重（**提出人已经想到了这一点，是对的**）
- 记录已消费的字节位置（每 pane 一个 cursor），重启后从 cursor 之后扫

---

## 3. 让它可信：nonce + 状态校验

光"匹配格式"不够，必须**同时校验语义状态**。

```
Neeko 生成：nonce = random(16) 绑定 (team_id, member_id, task_id, attempt)
注入任务体：请在最后一行输出
           NEEKO_RESULT <nonce> {"executionId":"<uuid>","status":"completed","summary":"..."}

接受条件（全部满足）：
 ① 前缀 + nonce 精确匹配
 ② JSON 可解析，status ∈ {completed, failed, blocked}
 ③ json.task_id 存在，且该任务 owner == 本 member，state ∈ {in_progress, awaiting_approval}
 ④ executionId 未消费过
不满足 → 记一条 audit（原因可读）后丢弃；**不向终端回错误**（in-band 无法回错）
```

**第 ③ 条是关键**：回显出来的模板里 `task_id` 通常是占位符或旧值，会被状态校验直接杀掉。
这比"只匹配格式"强一个量级，且成本几乎为零 —— 因为 `TeamManager` 本来就持有权威状态。

> 注意：nonce 挡不住"模型故意偷看后伪造"。但那种情况**任何通道都挡不住** —— MCP 也一样，
> 因为最终仍是 agent 自己声明。nonce 的目标是挡**意外的回显**，不是挡恶意。
> 真正的可信边界只有一条：**人**（审批门 + 可区分 verified/unverified）。

---

## 4. 通道能力矩阵（sentinel 的边界）

| 能力 | hook | **sentinel** | MCP | 屏幕 manifest |
| --- | --- | --- | --- | --- |
| 完成（when） | ✅ | ✅ | ✅ | ⚠️ 猜 |
| **结果（what）** | ❌ | ✅ | ✅ | ❌ |
| 卡住（blocked） | ✅ approval/input | ❌ | ❌ | ⚠️ 猜 |
| 身份可验证 | ⚠️ env 归因 | ❌ | ✅ token | ❌ |
| 需要 CLI 配合 | 装 hook | **零** | 装 MCP | 写规则 |
| in-band（会被污染） | ❌ | **✅ 有风险** | ❌ | ✅ |

**sentinel 明确的边界：它解决"完成 + 结果"，不解决"卡住了"。**
审批框弹出时 agent 不会打 sentinel ⇒ `Awaiting` 仍必须靠 hook 或屏幕。
所以 no-hook 的成员**会永久停在"看起来在跑"**，除非配屏幕兜底。

⇒ `WorkerChannel` 扩展为 `result_channel: Mcp | Sentinel | None`，且 UI 必须按通道显示不同可信度。

---

## 5. 对 R0 准入矩阵的修正

| 原判 | 修正后 |
| --- | --- |
| 无 `turn_completed` ⇒ **不允许当成员**（R0.4） | 无 hook ⇒ **允许，但降级到 Sentinel 通道**，UI 标"结果不可靠 + 卡住不可检测" |
| `gemini` / `grok` / `reasonix` **拒绝** | **可当成员**（Sentinel only）；`dsh` 仍拒绝（无 `AgentConfig`，无法 spawn） |

这把"能不能当成员"从二元变成三档：
1. **A 档** hook + MCP
2. **B 档** hook only → sentinel 补结果
3. **C 档** sentinel only → 结果可用、卡住不可知

---

## 6. 与 rmux 的关系

**不需要 rmux。** `terminal/pump.rs` 已经在 Rust 侧持有原始字节流（emit 之前），加一个"第二个 sink 消费者"即可。
rmux 的 `wait_for_text` 只是同一件事的另一种封装，且它**不做语义校验** —— 我们真正需要的
`task_id owner + state` 校验必须在 `TeamManager` 里做，那是 Neeko 独有的东西。

---

## 7. 建议落点

- `prd.md`：R0.4 改为三档准入；新增 R4.5 sentinel 通道（nonce + 状态校验 + 幂等）
- `design.md`：§5 增加 sentinel 扫描器（接在 pump sink，`spawn_blocking` 无关——纯字节处理）；
  §2 `WorkerChannel` 加 `Sentinel`
- `implement.md`：P1 加扫描器纯函数单测（分片/ANSI/多行/回显/重复）；P2 加 nonce 注入与状态校验
- 测试清单：① 跨帧切分 ② 回显模板被状态校验拒绝 ③ 重复 executionId 只消费一次
  ④ 超长行丢弃不爆内存 ⑤ 无 sentinel 但有 turn_completed → unverified
