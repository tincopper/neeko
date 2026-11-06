import { describe, expect, it } from 'vitest';

import { resolveTabTitle } from '@/features/editor/utils/tabTitle';
import type { SessionView } from '@/shared/types/liveSessions';
import type { TabLike } from '@/shared/types/tab';

function session(title: string): SessionView {
  return {
    sessionId: 's1',
    kind: 'chat',
    agentId: 'pi',
    workspaceKey: 'p1\0',
    title,
    titleSource: 'prompt',
    state: 'ready',
    startedAt: '2026-10-31T10:00:00.000Z',
    updatedAt: '2026-10-31T10:00:00.000Z',
    turnCount: 1,
    hasUserInput: true,
  };
}

const TAB: TabLike = { id: 'tab-1', title: 'Agent Chat' };

describe('resolveTabTitle', () => {
  it('注册表标题优先（tab 的常量标题不再是最终结果）', () => {
    expect(resolveTabTitle(TAB, session('修复登录跳转'))).toBe('修复登录跳转');
  });

  it('还没发出过输入（hasUserInput=false）⇒ 显示 tab 自带标题', () => {
    // 只打开了 tab：会话还没被用户用过，tab 显示 agent 名（侧栏此刻也没有这条会话）
    expect(resolveTabTitle(TAB, { ...session('修复登录跳转'), hasUserInput: false })).toBe(
      'Agent Chat',
    );
  });

  it('无会话（创建期 / tab 已脱离注册表）回落 tab 自带标题', () => {
    expect(resolveTabTitle(TAB, null)).toBe('Agent Chat');
    expect(resolveTabTitle(TAB, undefined)).toBe('Agent Chat');
  });

  it('注册表标题为空 / 全空白时回落 tab 标题（不渲染一条不可辨认的空白 tab）', () => {
    expect(resolveTabTitle(TAB, session(''))).toBe('Agent Chat');
    expect(resolveTabTitle(TAB, session('   '))).toBe('Agent Chat');
  });

  it('已输入但还没名字 ⇒ 回落 tab 标题（侧栏会列出它，但 tab 不能变成空串）', () => {
    expect(
      resolveTabTitle(TAB, { ...session(''), titleSource: 'placeholder', hasUserInput: true }),
    ).toBe('Agent Chat');
  });

  it('纯函数：同一输入两次结果相同，且不修改入参（派生不写回 store）', () => {
    const s = session('修复登录跳转');
    const before = { ...s };
    expect(resolveTabTitle(TAB, s)).toBe(resolveTabTitle(TAB, s));
    expect(s).toEqual(before);
    expect(TAB.title).toBe('Agent Chat');
  });
});
