import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useEditorStore } from '@/shared/store/editorStore';
import { selectActiveTabId } from '@/shared/store/editorTabSelectors';
import { useProjectStore } from '@/shared/store/projectStore';
import { useWorkspaceStore } from '@/shared/store/workspaceStore';
import type { SessionView } from '@/shared/types/liveSessions';
import type { Tab } from '@/shared/types/tab';
import { WorkspaceSession, type ProjectId } from '@/shared/utils/workspaceRef';

import { useActivateSession } from '../useActivateSession';

/**
 * 侧栏**会话行**点击 = 该行的**项目**与**单元**都成为当前。
 *
 * 缺陷形态：只切单元不切项目 ⇒ tab 在 B 的 tab 空间里被激活、单元状态也切了，中心视图仍停在
 * A，用户看到的是「点了没反应」。这里钉两件事：
 *
 * 1. 跨项目 ⇒ 必须在**切换序列结算之后**才落单元并激活 tab（顺序断言）；
 * 2. 同项目 ⇒ 那条序列**零调用**（它会清空各项目单元 + 回主仓，对已激活项目是纯破坏）。
 */
const P1 = 'p1' as ProjectId;
const P2 = 'p2' as ProjectId;
const WT_B = '/repo/wt-b';
const UNIT_B = WorkspaceSession.of(P2, WT_B);

const originalSetActiveWorkspace = useWorkspaceStore.getState().setActiveWorkspace;

function terminalTab(session: WorkspaceSession, id: string, ptySessionId: string): Tab {
  return {
    id,
    scope: { kind: 'workspace', session },
    title: 'B 会话',
    data: { kind: 'terminal', agentId: 'claude-code', ptySessionId },
  };
}

function sessionOf(unit: WorkspaceSession): SessionView {
  return {
    sessionId: 'pty-b',
    kind: 'terminal',
    attribution: { kind: 'user' },
    agentId: 'claude-code',
    workspaceKey: unit.key,
    title: 'B 会话',
    titleSource: 'prompt',
    state: 'ready',
    startedAt: '2026-11-02T10:00:00.000Z',
    updatedAt: '2026-11-02T10:00:00.000Z',
    turnCount: 1,
    hasUserInput: true,
  };
}

function recordUnits(order: string[]): void {
  useWorkspaceStore.setState({
    setActiveWorkspace: (projectId, path, branch) => {
      order.push(`unit:${projectId}@${path ?? 'main'}`);
      originalSetActiveWorkspace(projectId, path, branch);
    },
  });
}

beforeEach(() => {
  useEditorStore.setState({ tabs: {}, editorLayout: {} });
  useWorkspaceStore.setState({ byProject: {}, setActiveWorkspace: originalSetActiveWorkspace });
  useProjectStore.setState({ activeProjectId: P1, activeProject: null });
  // 两条 tab，`addTab` 激活后一条 ⇒ 「激活 tab」这个动作在断言里可观测。
  useEditorStore.getState().addTab(terminalTab(UNIT_B, 'tab-b', 'pty-b'));
  useEditorStore.getState().addTab(terminalTab(UNIT_B, 'tab-x', 'pty-x'));
});

describe('useActivateSession — 跨项目会话行', () => {
  it('先切项目（等序列结算）、再落单元、最后激活 tab', async () => {
    const order: string[] = [];
    recordUnits(order);
    const activateTab = useEditorStore.getState().activateTab;
    useEditorStore.setState({
      activateTab: (key, id) => {
        order.push('activate-tab');
        activateTab(key, id);
      },
    });
    // 序列内部有真正的 await（type widening 的理由：实现本来就是 async）
    const onSelectProject = vi.fn(async (projectId: ProjectId) => {
      await Promise.resolve();
      order.push(`select:${projectId}`);
      useProjectStore.setState({ activeProjectId: projectId });
    });

    // 不包 Provider：本 hook 也被组合根（`useDockBarOpenTab`）在 Provider 树**之外**调用，
    // 能力是入参（`selectProject`），不是 `useContext`。
    const { result } = renderHook(() => useActivateSession(onSelectProject));

    await act(async () => {
      result.current(sessionOf(UNIT_B));
    });

    expect(onSelectProject).toHaveBeenCalledWith(P2);
    expect(order).toEqual(['select:p2', 'unit:p2@/repo/wt-b', 'activate-tab']);
    // 点击之后：项目与单元都是该行所属
    expect(useProjectStore.getState().activeProjectId).toBe(P2);
    expect(useWorkspaceStore.getState().byProject[P2]?.activePath).toBe(WT_B);
    expect(selectActiveTabId(useEditorStore.getState(), UNIT_B.key)).toBe('tab-b');
  });

  it('切换序列在途时单元/ tab 都不动（不自己擦掉刚点的单元）', async () => {
    const order: string[] = [];
    recordUnits(order);
    useProjectStore.setState({ activeProjectId: P1 });

    let settle!: () => void;
    const onSelectProject = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          settle = () => {
            useProjectStore.setState({ activeProjectId: P2 });
            resolve();
          };
        }),
    );

    // 不包 Provider：本 hook 也被组合根（`useDockBarOpenTab`）在 Provider 树**之外**调用，
    // 能力是入参（`selectProject`），不是 `useContext`。
    const { result } = renderHook(() => useActivateSession(onSelectProject));

    act(() => {
      result.current(sessionOf(UNIT_B));
    });
    await Promise.resolve();

    expect(order).toEqual([]);
    expect(selectActiveTabId(useEditorStore.getState(), UNIT_B.key)).toBe('tab-x');

    await act(async () => {
      settle();
    });

    expect(order).toEqual(['unit:p2@/repo/wt-b']);
    expect(selectActiveTabId(useEditorStore.getState(), UNIT_B.key)).toBe('tab-b');
  });
});

describe('useActivateSession — 当前项目内的会话行（零回归）', () => {
  it('不调 onSelectProject，只落单元并激活 tab', async () => {
    useProjectStore.setState({ activeProjectId: P2 });
    const onSelectProject = vi.fn();

    // 不包 Provider：本 hook 也被组合根（`useDockBarOpenTab`）在 Provider 树**之外**调用，
    // 能力是入参（`selectProject`），不是 `useContext`。
    const { result } = renderHook(() => useActivateSession(onSelectProject));

    await act(async () => {
      result.current(sessionOf(UNIT_B));
    });

    expect(onSelectProject).not.toHaveBeenCalled();
    expect(useWorkspaceStore.getState().byProject[P2]?.activePath).toBe(WT_B);
    expect(selectActiveTabId(useEditorStore.getState(), UNIT_B.key)).toBe('tab-b');
  });
});
