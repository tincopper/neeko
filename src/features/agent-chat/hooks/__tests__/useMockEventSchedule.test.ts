import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { SequencedEvent } from '@/shared/types/agentChat';
import { WorkspaceSession } from '@/shared/utils/workspaceRef';

import { useMockEventSchedule } from '../useMockEventSchedule';

/**
 * mock 演示流与真实路径**同源**：`context_init` 的 `workspace_key` / `cwd` 必须来自 tab 的地址。
 *
 * 反例是「mock 一律按主 checkout 回显」（曾经的写法 `WorkspaceSession.of(projectId, null)`）——
 * 于是 worktree 单元里打开演示会话，横幅显示主仓根，与真实会话相反。演示路径骗人比没有更糟。
 */
describe('useMockEventSchedule', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('echoes the tab workspace address in context_init', () => {
    const events: SequencedEvent[] = [];
    const workspace = WorkspaceSession.of('p1', '/p1/.worktrees/dev');

    renderHook(() =>
      useMockEventSchedule({
        mockMode: true,
        sessionId: 'mock-session',
        workspace,
        applyEvent: (ev) => events.push(ev),
        sessionIdRef: { current: undefined },
        turnStartRef: { current: null },
        turnCountsRef: { current: { ran: 0, edited: 0, searched: 0 } },
        turnToolsRef: { current: [] },
      }),
    );

    act(() => {
      vi.advanceTimersByTime(120);
    });

    const init = events.find((ev) => ev.type === 'context_init');
    expect(init).toBeDefined();
    if (init?.type !== 'context_init') throw new Error('unreachable');
    expect(init.workspace_key).toBe(workspace.key);
    expect(init.cwd).toBe('/p1/.worktrees/dev');
  });

  it('main checkout echoes the main-unit key (empty path component)', () => {
    const events: SequencedEvent[] = [];
    const workspace = WorkspaceSession.of('p1', null);

    renderHook(() =>
      useMockEventSchedule({
        mockMode: true,
        sessionId: 'mock-session',
        workspace,
        applyEvent: (ev) => events.push(ev),
        sessionIdRef: { current: undefined },
        turnStartRef: { current: null },
        turnCountsRef: { current: { ran: 0, edited: 0, searched: 0 } },
        turnToolsRef: { current: [] },
      }),
    );

    act(() => {
      vi.advanceTimersByTime(120);
    });

    const init = events.find((ev) => ev.type === 'context_init');
    if (init?.type !== 'context_init') throw new Error('context_init missing');
    expect(init.workspace_key).toBe(workspace.key);
    expect(init.workspace_key.endsWith('\u0000')).toBe(true);
  });
});
