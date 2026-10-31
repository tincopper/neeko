import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * `openExistingTerminalTab` 的接管入口回归。
 *
 * 判据的核心是**同一后端会话只能有一个 tab**：drain 是 per-session 的单队列
 * （后端 `SessionDrain` 按 session 存），两个 tab 同时拉会各自偷走对方要的字节 ——
 * 表现为两个终端都缺输出。这是后端缓冲模型的直接后果，不是 UI 偏好。
 */

vi.mock('@/features/terminal/components/terminalTabCleanup', async () => {
  const { useEditorStore } = await import('@/shared/store/editorStore');
  return {
    closeEditorTab: vi.fn((tabKey: string, tabId: string) => {
      useEditorStore.getState().closeTab(tabKey, tabId);
    }),
    closeAllEditorTabs: vi.fn((tabKey: string) => {
      useEditorStore.getState().clearProjectTabs(tabKey);
    }),
    cleanupTerminalsForTab: vi.fn(),
    cleanupTerminalsForTabKey: vi.fn(),
  };
});

import { useTerminalTabs } from '@/features/terminal/hooks/useTerminalTabs';
import { activeTabIdOf, useEditorStore } from '@/shared/store/editorStore';
import { WorkspaceSession } from '@/shared/utils/workspaceRef';

const PROJECT_ID = 'p1';
const SPACE = WorkspaceSession.of(PROJECT_ID, null).key;

/** 该 tab 空间里 terminal tab 的 `existingSessionId` 列表（断言「接管字段真的落在 tab 上」）。 */
function takeoverIdsOf(tabKey: string): (string | undefined)[] {
  return (useEditorStore.getState().tabs[tabKey]?.tabs ?? [])
    .filter((tab) => tab.data.kind === 'terminal')
    .map((tab) => (tab.data.kind === 'terminal' ? tab.data.existingSessionId : undefined));
}

describe('useTerminalTabs.openExistingTerminalTab', () => {
  beforeEach(() => {
    useEditorStore.setState({ tabs: {}, editorLayout: {} });
  });

  it('打开一个接管既有会话的 tab：写入 existingSessionId 并激活', () => {
    const { result } = renderHook(() => useTerminalTabs());

    let created: ReturnType<typeof result.current.openExistingTerminalTab> = null;
    act(() => {
      created = result.current.openExistingTerminalTab(PROJECT_ID, 'lead-session', 'Team Lead');
    });

    expect(created).not.toBeNull();
    expect(created!.id).not.toBe('');
    expect(created!.projectId).toBe(PROJECT_ID);
    expect(created!.title).toBe('Team Lead');

    expect(takeoverIdsOf(SPACE)).toEqual(['lead-session']);
    expect(activeTabIdOf(SPACE)).toBe(created!.id);
  });

  it('同一 sessionId 第二次调用：不开新 tab，激活已有的那个', () => {
    const { result } = renderHook(() => useTerminalTabs());

    let first: ReturnType<typeof result.current.openExistingTerminalTab> = null;
    act(() => {
      first = result.current.openExistingTerminalTab(PROJECT_ID, 'lead-session', 'Team Lead');
      // 用户切到别的 tab —— 此时再打开同一会话必须回到原来那个，而不是复制一个。
      result.current.addTab(PROJECT_ID);
    });

    const takenOver = first!;
    expect(activeTabIdOf(SPACE)).not.toBe(takenOver.id);

    const tabsBefore = useEditorStore.getState().tabs[SPACE].tabs.length;

    let second: ReturnType<typeof result.current.openExistingTerminalTab> = null;
    act(() => {
      second = result.current.openExistingTerminalTab(PROJECT_ID, 'lead-session', 'Team Lead');
    });

    expect(second!.id).toBe(takenOver.id);
    expect(useEditorStore.getState().tabs[SPACE].tabs.length).toBe(tabsBefore);
    // 中途 `addTab` 开的普通 tab 不算接管（filter 掉 undefined）
    expect(takeoverIdsOf(SPACE).filter(Boolean)).toEqual(['lead-session']);
    expect(activeTabIdOf(SPACE)).toBe(takenOver.id);
  });

  it('不同 sessionId：各开一个 tab（不误判成重复）', () => {
    const { result } = renderHook(() => useTerminalTabs());

    act(() => {
      result.current.openExistingTerminalTab(PROJECT_ID, 'lead-session', 'Team Lead');
    });
    act(() => {
      result.current.openExistingTerminalTab(PROJECT_ID, 'member-session', 'Member');
    });

    expect(takeoverIdsOf(SPACE)).toEqual(['lead-session', 'member-session']);
  });

  it('与 addTab 共用配额：满 10 个 terminal tab 时返回 null', () => {
    const { result } = renderHook(() => useTerminalTabs());

    act(() => {
      for (let i = 0; i < 10; i++) result.current.addTab(PROJECT_ID);
    });

    let created: ReturnType<typeof result.current.openExistingTerminalTab> = null;
    act(() => {
      created = result.current.openExistingTerminalTab(PROJECT_ID, 'lead-session', 'Team Lead');
    });

    expect(created).toBeNull();
    expect(takeoverIdsOf(SPACE)).toEqual(Array.from({ length: 10 }, () => undefined));
  });
});
