import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { AGENT_CHAT_EVENT, SESSIONS_EVENT, TRANSLATION_EVENT } from '@/shared/events';

/**
 * 跨栈护栏：`SESSIONS_EVENT` 两端必须**同值**（红线 5：事件名只允许来自单一常量源）。
 *
 * # 为什么断言「值相等」而不是「子串出现过」
 *
 * `expect(rustSource).toContain(SESSIONS_EVENT)` 只证明字符串在文件里出现过 ——
 * 注释、文档、被注释掉的旧声明都能让它变绿，而两端真正用的名字仍然是两个。
 * 这里把后端的**声明**抠出来，与前端常量逐字比较；声明缺失 / 出现多次都直接红
 * （重命名后残留旧声明是最常见的半改状态）。
 *
 * 形态照 `src/shared/types/__tests__/transports.test.ts`（读后端源码断言跨栈契约）。
 */
const RUST_EVENTS_FILE = resolve(__dirname, '../../../src-tauri/src/live_sessions/events.rs');

/** 后端唯一声明的值；缺失返回 `null`（交给用例报红，不在读取阶段抛错）。 */
function backendSessionsEvent(): string | null {
  const rust = readFileSync(RUST_EVENTS_FILE, 'utf8');
  const matches = [...rust.matchAll(/pub const SESSIONS_EVENT: &str = "([^"]+)";/g)];
  // 0 条 = 声明被改名/搬走（本护栏失去判据）；多条 = 存在两个事件名。
  return matches.length === 1 ? matches[0][1] : null;
}

describe('SESSIONS_EVENT mirrors the backend constant', () => {
  it('is declared exactly once in the backend', () => {
    expect(backendSessionsEvent()).not.toBeNull();
  });

  it('has the same value on both sides', () => {
    expect(SESSIONS_EVENT).toBe(backendSessionsEvent());
  });

  it('does not collide with another event channel', () => {
    // 值相等挡不住「两端一起抄错」：把 AGENT_CHAT_EVENT 的值搬到后端，上面两条仍绿，
    // 而状态变更会与 chat 事件流挤进同一通道。
    expect(SESSIONS_EVENT).not.toBe(AGENT_CHAT_EVENT);
    expect(SESSIONS_EVENT).not.toBe(TRANSLATION_EVENT);
  });
});
