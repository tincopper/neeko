# Design — attach-only 接回

## 1. 判据：调用方给 `attachSessionId` 就是「只要那一条，不要替代品」

`attachSessionId` 的语义在 prop 注释里早已写明：「已有且仍活着的 PTY 会话 id（关 tab 时选了
『后台运行』）：接回它，不新建」。实现却在探针失败时落到新建 —— 注释与代码不一致，而**注释是
对的**。所以本任务不改契约，只让实现追上它。

为什么「失败就新建」在任何调用场景下都错：

| 调用方 | 用户以为点开的是 | 实际拿到（当前） |
| --- | --- | --- |
| 花名册「打开会话」 | 队长的会话 | 一条新 PTY + 自动拉起的同款 CLI，**没有**团队 MCP / 凭证 / 隔离目录 |
| 侧栏团队行 | 同上 | 同上 |
| 侧栏会话行（`sessionTabFactory` 的 live 分支） | 那条后台会话 | 一条**无关的**空终端（`resumeFromSessionId` 没传，所以连 `adopt` 都不发生）|

第三行尤其能说明性质：同一个函数在「快照说已结束」时走的是**续写**分支（`resumeFromSessionId`
+ `--resume`），只有在「快照说活着但实际已死」时它才变成「开一条新的、什么关系都没有的终端」。
同一个用户意图得到两种截然不同的结果，唯一原因是那条路径**没有名字**（不是续写、不是接回，
只是 `?? createSession`）。

## 2. 失效态的形状

```
turnView: 'connecting' | 'ready' | 'attach-failed'
```

替换现在的 `ready: boolean`。三态而不是加一个 `attachFailed: boolean`，因为「连上了」与
「接回失败」是同一件事的互斥结果，两个布尔量能拼出「既 ready 又 failed」这种不存在的状态。

渲染：

| 状态 | 覆盖层 |
| --- | --- |
| `connecting` | `Connecting...`（今天的样子） |
| `attach-failed` | `This session has ended.` + 一行小字 `Close the tab and reopen it from where you opened it.` |
| `ready` | 无 |

- `role="status"` + `data-testid="terminal-attach-failed"`：读屏能听到、测试能钉住。
- **不给按钮**（R5 的反面）：恢复动作属于调用方（花名册五态 / `sessionTabFactory` 的 resume
  分支）。在终端视图里再放一个「重新打开」就是第三套判据，而且它没有 `resumable` / `sealed`
  两列，必然猜错。

## 3. 早退点：必须在**启动写管线之前**

失败分支要 `return`，且位置在 `setReady` / `onSessionCreated` / drain 订阅 / auto-launch 之前：

```text
entry 建立（xterm 已 open）
  ├─ attachSessionId ?
  │    ├─ attachLiveSession → 命中 ⇒ sessionId，继续原路径（attached = true）
  │    └─ null ⇒ turnView = 'attach-failed'; return      ← 新增的唯一分叉
  └─ 无 ⇒ createSessionVal（原路径）
```

早退后 `entry.sessionId` 保持 `null`：销毁路径里的 `closeSession` 以 `entry.sessionId` 为前提，
于是**不会**去关一条不属于自己的会话（`terminalCache` 的 `closeIfOwned` 同一前提）。

## 4. 与「关 tab 不 kill 进程」的关系

接回成功时 `attached = true`，销毁路径据此不 close（那会 kill 掉队长的进程）。失败时没有会话，
两个分支都无事可做 —— 语义自动正确，不需要额外判据。

## 5. 测试策略

`TerminalViewBase` 的既有测试都不覆盖 attach（`TerminalViewBase.fitScheduler.test.tsx` 只测
fit 调度）。新增一个 `TerminalViewBase.attach.test.tsx`，用最小 FakeStrategy 直接驱动：

| 用例 | 断言 |
| --- | --- |
| 探针 false | `strategy.createSession` 零调用；`terminal-attach-failed` 出现；无 `terminal-input-*` emit；无 `terminal_drain*` invoke |
| 探针 true | 不新建、无提示、`ready`（无 `Connecting...`）|
| 无 attachSessionId | 照常新建（回归锚点）|

策略对象是注入的端口（`TerminalStrategy`），所以这一层可以脱离 PTY 直测 —— 不需要后端。
