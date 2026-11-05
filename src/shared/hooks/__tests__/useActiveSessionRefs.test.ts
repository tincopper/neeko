import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { useActiveSessionRefs } from '@/shared/hooks/useActiveSessionRefs';
import { useEditorStore } from '@/shared/store/editorStore';
import { useProjectStore } from '@/shared/store/projectStore';
import { useWorkspaceStore } from '@/shared/store/workspaceStore';
import type { EditorSplitLayout, ProjectTabs, Tab } from '@/shared/types';
import { createDefaultEditorLayout } from '@/shared/types/editorGroup';
import { WorkspaceSession } from '@/shared/utils/workspaceRef';

const P1 = WorkspaceSession.of('p1', null).projectId;
const P2 = WorkspaceSession.of('p2', null).projectId;
const MAIN_A = WorkspaceSession.of(P1, null).key;
const MAIN_B = WorkspaceSession.of(P2, null).key;
const WT_A = WorkspaceSession.of(P1, '/repo/.worktrees/dev').key;

/** 一个单元、一条中心前台会话 tab（布局与注册表都按唯一权威形态构造）。 */
function frontSpace(sessionId: string): { tabs: ProjectTabs; layout: EditorSplitLayout } {
  const layout = createDefaultEditorLayout();
  const tab: Tab = {
    id: `tab-${sessionId}`,
    scope: { kind: 'app' },
    title: sessionId,
    data: { kind: 'terminal', agentId: null, ptySessionId: sessionId },
  };
  layout.groups.left = { tabIds: [tab.id], activeTabId: tab.id };
  return { tabs: { tabs: [tab] }, layout };
}

function seedEditor(spaces: ReadonlyArray<{ key: string; sessionId: string }>): void {
  const tabs: Record<string, ProjectTabs> = {};
  const editorLayout: Record<string, EditorSplitLayout> = {};
  for (const { key, sessionId } of spaces) {
    const space = frontSpace(sessionId);
    tabs[key] = space.tabs;
    editorLayout[key] = space.layout;
  }
  useEditorStore.setState({ tabs, editorLayout });
}

beforeEach(() => {
  useEditorStore.setState({ tabs: {}, editorLayout: {} });
  useWorkspaceStore.setState({ byProject: {} });
  useProjectStore.setState({ activeProjectId: null });
});

describe('useActiveSessionRefs — 「当前前台会话」的全局唯一派生点（R8）', () => {
  it('两个项目各有前台会话：切 activeProjectId 后 refs 整体翻转（旧单元立即熄灭）', () => {
    seedEditor([
      { key: MAIN_A, sessionId: 'pty-a' },
      { key: MAIN_B, sessionId: 'pty-b' },
    ]);
    useProjectStore.setState({ activeProjectId: P1 });
    const { result } = renderHook(() => useActiveSessionRefs());

    expect(result.current).toEqual([
      { workspaceKey: MAIN_A, kind: 'terminal', sessionId: 'pty-a' },
    ]);

    act(() => {
      useProjectStore.setState({ activeProjectId: P2 });
    });

    expect(result.current).toEqual([
      { workspaceKey: MAIN_B, kind: 'terminal', sessionId: 'pty-b' },
    ]);
  });

  it('同一项目切 worktree ⇒ 旧单元不再产出 ref', () => {
    seedEditor([
      { key: MAIN_A, sessionId: 'pty-main' },
      { key: WT_A, sessionId: 'pty-wt' },
    ]);
    useProjectStore.setState({ activeProjectId: P1 });
    const { result } = renderHook(() => useActiveSessionRefs());
    expect(result.current.map((ref) => ref.sessionId)).toEqual(['pty-main']);

    act(() => {
      useWorkspaceStore.getState().setActiveWorkspace(P1, '/repo/.worktrees/dev', 'dev');
    });

    expect(result.current).toEqual([{ workspaceKey: WT_A, kind: 'terminal', sessionId: 'pty-wt' }]);
  });

  it('没有当前项目 ⇒ 共享空常量（重渲染不换引用）', () => {
    seedEditor([{ key: MAIN_A, sessionId: 'pty-a' }]);
    const { result, rerender } = renderHook(() => useActiveSessionRefs());
    const first = result.current;
    expect(first).toEqual([]);

    rerender();
    expect(result.current).toBe(first);
  });
});
