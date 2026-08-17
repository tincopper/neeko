import { beforeEach, describe, expect, it } from 'vitest';

import { useEditorStore } from '@/shared/store/editorStore';
import { useProjectStore } from '@/shared/store/projectStore';
import { useWorktreeStore } from '@/shared/store/worktreeStore';
import { createProject } from '@/testing/factories';

import { useMruTabsStore } from '../mruTabsStore';
import { advanceTabCycle, buildTabCycleOrder, useTabCycleStore } from '../tabCycleStore';

function seedStores() {
  useWorktreeStore.setState({ activeWorktreePath: null, activeWorktreeBranch: '' });
  useProjectStore.setState({
    activeProjectId: 'p1',
    activeProject: createProject({ id: 'p1' }),
  });
  useMruTabsStore.setState({ byTabKey: {} });
  useTabCycleStore.setState({ session: null });
}

function seedTabs(tabs: { id: string; title: string }[], activeId: string) {
  useEditorStore.setState({
    tabs: {
      p1: {
        tabs: tabs.map((t, i) => ({
          id: t.id,
          projectId: 'p1',
          title: t.title,
          order: i,
          data: {
            kind: 'file' as const,
            filePath: `${t.id}.ts`,
            fileName: `${t.id}.ts`,
            content: { path: `${t.id}.ts`, content: '', size: 0, is_binary: false },
            isDirty: false,
          },
        })),
        activeTabId: activeId,
      },
    },
  });
}

describe('buildTabCycleOrder', () => {
  it('returns [active, ...MRU-recent-first others]', () => {
    expect(buildTabCycleOrder(['t1', 't2'], ['t0', 't1', 't2'], 't0')).toEqual(['t0', 't1', 't2']);
  });

  it('appends tabs missing from MRU in tab order', () => {
    expect(buildTabCycleOrder(['t2'], ['t0', 't1', 't2'], 't0')).toEqual(['t0', 't2', 't1']);
  });

  it('filters stale ids and dedupes', () => {
    expect(buildTabCycleOrder(['t1', 't9', 't1'], ['t0', 't1'], 't0')).toEqual(['t0', 't1']);
  });

  it('returns null with fewer than 2 tabs', () => {
    expect(buildTabCycleOrder([], ['t0'], 't0')).toBeNull();
  });

  it('returns null without an active tab', () => {
    expect(buildTabCycleOrder(['t1'], ['t0', 't1'], null)).toBeNull();
  });
});

describe('advanceTabCycle', () => {
  const order = ['t0', 't1', 't2'];

  it('advances forward and wraps', () => {
    expect(advanceTabCycle(order, 0, 1)).toEqual({ targetId: 't1', nextCursor: 1 });
    expect(advanceTabCycle(order, 2, 1)).toEqual({ targetId: 't0', nextCursor: 0 });
  });

  it('advances backward and wraps', () => {
    expect(advanceTabCycle(order, 0, -1)).toEqual({ targetId: 't2', nextCursor: 2 });
    expect(advanceTabCycle(order, 1, -1)).toEqual({ targetId: 't0', nextCursor: 0 });
  });
});

describe('useTabCycleStore.cycleTab', () => {
  beforeEach(seedStores);

  it('first Ctrl+Tab activates the MRU previous tab', () => {
    useMruTabsStore.setState({ byTabKey: { p1: ['t1', 't2'] } });
    seedTabs(
      [
        { id: 't0', title: 'a' },
        { id: 't1', title: 'b' },
        { id: 't2', title: 'c' },
      ],
      't0',
    );

    useTabCycleStore.getState().cycleTab(1);

    expect(useEditorStore.getState().tabs.p1?.activeTabId).toBe('t1');
    expect(useTabCycleStore.getState().session?.cursor).toBe(1);
  });

  it('repeated Ctrl+Tab keeps rotating through the snapshot order', () => {
    useMruTabsStore.setState({ byTabKey: { p1: ['t1', 't2'] } });
    seedTabs(
      [
        { id: 't0', title: 'a' },
        { id: 't1', title: 'b' },
        { id: 't2', title: 'c' },
      ],
      't0',
    );

    const s = useTabCycleStore.getState();
    s.cycleTab(1);
    expect(useEditorStore.getState().tabs.p1?.activeTabId).toBe('t1');
    s.cycleTab(1);
    expect(useEditorStore.getState().tabs.p1?.activeTabId).toBe('t2');
    s.cycleTab(1);
    expect(useEditorStore.getState().tabs.p1?.activeTabId).toBe('t0');
  });

  it('Ctrl+Shift+Tab reverses direction', () => {
    useMruTabsStore.setState({ byTabKey: { p1: ['t1', 't2'] } });
    seedTabs(
      [
        { id: 't0', title: 'a' },
        { id: 't1', title: 'b' },
        { id: 't2', title: 'c' },
      ],
      't0',
    );

    const s = useTabCycleStore.getState();
    s.cycleTab(-1); // reverse from t0 → least recent (t2)
    expect(useEditorStore.getState().tabs.p1?.activeTabId).toBe('t2');
    s.cycleTab(-1);
    expect(useEditorStore.getState().tabs.p1?.activeTabId).toBe('t1');
  });

  it('resets the cycle after idle TTL (rebuilds order from current state)', () => {
    useMruTabsStore.setState({ byTabKey: { p1: ['t1', 't2'] } });
    seedTabs(
      [
        { id: 't0', title: 'a' },
        { id: 't1', title: 'b' },
        { id: 't2', title: 'c' },
      ],
      't0',
    );

    const s = useTabCycleStore.getState();
    s.cycleTab(1); // → t1, order [t0,t1,t2], cursor 1
    expect(useTabCycleStore.getState().session?.order).toEqual(['t0', 't1', 't2']);

    useTabCycleStore.setState({
      session: { ...useTabCycleStore.getState().session!, expiresAt: 0 },
    });
    s.cycleTab(1); // expired → fresh rebuild from t1 → order [t1,t2,t0], cursor 1

    const session = useTabCycleStore.getState().session!;
    expect(useEditorStore.getState().tabs.p1?.activeTabId).toBe('t2');
    expect(session.order).toEqual(['t1', 't2', 't0']);
    expect(session.cursor).toBe(1);
  });

  it('resets the cycle when the active tab changes externally', () => {
    useMruTabsStore.setState({ byTabKey: { p1: ['t1', 't2'] } });
    seedTabs(
      [
        { id: 't0', title: 'a' },
        { id: 't1', title: 'b' },
        { id: 't2', title: 'c' },
      ],
      't0',
    );

    const s = useTabCycleStore.getState();
    s.cycleTab(1); // → t1, cursor 1
    useEditorStore.getState().activateTab('p1', 't2'); // user clicked elsewhere
    s.cycleTab(1); // lastActivated(t1) !== active(t2) → fresh from t2 → MRU prev (t1)
    expect(useEditorStore.getState().tabs.p1?.activeTabId).toBe('t1');
  });

  it('does nothing with a single tab', () => {
    seedTabs([{ id: 't0', title: 'a' }], 't0');
    useTabCycleStore.getState().cycleTab(1);
    expect(useEditorStore.getState().tabs.p1?.activeTabId).toBe('t0');
    expect(useTabCycleStore.getState().session).toBeNull();
  });

  it('does nothing without an active project', () => {
    useProjectStore.setState({ activeProjectId: null, activeProject: null });
    seedTabs(
      [
        { id: 't0', title: 'a' },
        { id: 't1', title: 'b' },
      ],
      't0',
    );
    useTabCycleStore.getState().cycleTab(1);
    expect(useEditorStore.getState().tabs.p1?.activeTabId).toBe('t0');
  });
});
