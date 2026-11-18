# Implement — attach-only 接回

Red → Green → Refactor。

## 1. 失效态（R1 / R2 / R3）

- [ ] **Red** `src/features/terminal/components/__tests__/TerminalViewBase.attach.test.tsx`：
      最小 `FakeStrategy`（`createSession` / `cache` / `cacheKey` / `dispose` 等按 `TerminalStrategy`
      端口实现，参考 `terminalCache.test.ts` 的写法）+ mock `@tauri-apps/api/core` 的 `invoke`。
      - `attachSessionId` 给出、`detach_terminal_session` 返回 `false` ⇒
        assert `strategy.createSession` 零调用、`terminal-attach-failed` 存在、
        无 `terminal-input-*` emit、无 `terminal_drain*` invoke、`Connecting...` 消失。
- [ ] **Green** `TerminalViewBase`：
      - `ready: boolean` → `turnView: 'connecting' | 'ready' | 'attach-failed'`（替换而不是叠加，
        见 design §2）。所有 `setReady(x)` 改为对应的 `setTurnView(...)`。
      - attach 分支：`attachLiveSession` 返回 `null` ⇒ `setTurnView('attach-failed')` 后 **return**
        （位置在 `setReady` / `onSessionCreated` / drain 订阅 / auto-launch 之前，见 design §3）。
- [ ] **Red/Green** 覆盖层：`turnView === 'attach-failed'` 时渲染 `role="status"`
      `data-testid="terminal-attach-failed"` 的提示（英文，两句：发生了什么 + 怎么办）。

## 2. 零回归（R4）

- [ ] **Red** 同测试文件：探针返回 `true` ⇒ 不新建 + 无提示（既有接回路径）。
- [ ] **Red** 同测试文件：无 `attachSessionId` ⇒ 照常 `createSession`（回归锚点）。
- [ ] 复核既有使用 `ready` 的地方（`TerminalViewBase` 内部只有覆盖层与 `setReady` 调用点，
      同文件内改完即可）。

## 3. 判据唯一性（R5 / AC5）

- [ ] `grep -rn "attachSessionId\|attachLiveSession" src --include=*.ts --include=*.tsx | grep -v __tests__`
      逐个复核；确认探针失败 ⇒ 新建 的兜底只剩本轮删掉的那一处。
- [ ] 若发现别处也有同一形态，收口到本判据（不要就地各写一份）。

## 4. 验证

- [ ] `pnpm exec vitest run src/features/terminal src/features/live-sessions src/features/agent-team`
- [ ] `pnpm exec tsc --noEmit`
- [ ] `pnpm check:quick`（收尾一次）

## 5. 文档同步（Phase 3.3）

- [ ] `.trellis/spec/backend/agent-chat-transports.md`「三种关闭选择」小节附近补一条：
      **接回是 attach-only** —— 探针失败不新建（否则得到一条没有团队 MCP / 凭证的裸 CLI），
      失效态由终端视图显示，恢复动作属于调用方。
- [ ] 若 `.trellis/spec/frontend/component-guidelines.md` 有终端失效态的段落，补同一句（不重复正文）。

## 回滚点

- 单文件行为改动（`TerminalViewBase` 一个分叉）+ 一个新测试文件。revert 即回到「探针失败就新建」，
  不影响任何其它路径。
