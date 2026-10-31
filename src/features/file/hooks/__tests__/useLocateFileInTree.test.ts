// Feature: "locate current file in the file tree".
//
// The hook reads the currently active editor tab for `tabKey`; when it is a
// file tab it exposes its path (and canLocateFile=true) so the Files panel can
// run the SAME selection flow as a manual click (handleSelectNode + parent
// expansion). Locating is just "auto-finding" — everything after reuses the
// click-selection path instead of a separate active-file highlight.
import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { useEditorStore } from '@/shared/store/editorStore';
import type { Tab } from '@/shared/types';
import { createDefaultEditorLayout } from '@/shared/types/editorGroup';
import { WorkspaceSession } from '@/shared/utils/workspaceRef';

import { useLocateFileInTree } from '../useLocateFileInTree';

/** 测试身份源：项目 id → WorkspaceSession（主仓形态）。 */
function mkSession(projectId: string) {
  return WorkspaceSession.of(projectId, null);
}

function makeFileTab(id: string, filePath: string): Tab {
  return {
    id,
    scope: { kind: 'workspace', session: mkSession('p1') },
    title: filePath,
    data: {
      kind: 'file',
      filePath,
      fileName: filePath.split('/').pop() ?? filePath,
      content: '',
      isDirty: false,
    },
  };
}

function makeTerminalTab(id: string): Tab {
  return {
    id,
    scope: { kind: 'workspace', session: mkSession('p1') },
    title: id,
    data: { kind: 'terminal', agentId: null },
  };
}

/** Seed one tab space at `tabKey` with a layout whose left group holds the tab
 *  and makes it foreground — 前台由布局派生（`selectActiveTabId`），夹具必须 seed layout。 */
function seedActive(tabKey: string, tab: Tab): void {
  const layout = createDefaultEditorLayout();
  layout.groups.left.tabIds = [tab.id];
  layout.groups.left.activeTabId = tab.id;
  useEditorStore.setState({
    tabs: { [tabKey]: { tabs: [tab] } },
    editorLayout: { [tabKey]: layout },
  });
}

describe('useLocateFileInTree', () => {
  beforeEach(() => {
    useEditorStore.setState({ tabs: {}, editorLayout: {} });
  });

  it('active file tab（相对路径）→ canLocate true and exposes its path', () => {
    seedActive('p1', makeFileTab('t1', 'src/hooks/useFilePanelState.ts'));

    const { result } = renderHook(() => useLocateFileInTree('p1'));
    expect(result.current.canLocateFile).toBe(true);
    expect(result.current.filePath).toBe('src/hooks/useFilePanelState.ts');
  });

  it('active file tab（canonical 绝对路径且在 root 下）→ 剥根成相对路径匹配树', () => {
    seedActive('p1', makeFileTab('t1', '/repo/src/hooks/useFilePanelState.ts'));

    const { result } = renderHook(() => useLocateFileInTree('p1', '/repo'));
    expect(result.current.canLocateFile).toBe(true);
    expect(result.current.filePath).toBe('src/hooks/useFilePanelState.ts');
  });

  it('绝对路径不在 root 下（外置根/盘符差异）→ 原样返回（树匹配自然失败）', () => {
    seedActive('p1', makeFileTab('t1', '/other/src/a.ts'));

    const { result } = renderHook(() => useLocateFileInTree('p1', '/repo'));
    expect(result.current.filePath).toBe('/other/src/a.ts');
  });

  it('root 未提供 → 绝对路径原样返回（保守，不剥）', () => {
    seedActive('p1', makeFileTab('t1', '/repo/src/a.ts'));

    const { result } = renderHook(() => useLocateFileInTree('p1'));
    expect(result.current.filePath).toBe('/repo/src/a.ts');
  });

  it('active terminal tab → canLocate false, filePath null', () => {
    seedActive('p1', makeTerminalTab('t1'));

    const { result } = renderHook(() => useLocateFileInTree('p1'));
    expect(result.current.canLocateFile).toBe(false);
    expect(result.current.filePath).toBeNull();
  });

  it('no tabs for tabKey → canLocate false', () => {
    const { result } = renderHook(() => useLocateFileInTree('p1'));
    expect(result.current.canLocateFile).toBe(false);
    expect(result.current.filePath).toBeNull();
  });
});
