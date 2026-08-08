// Feature: "locate current file in the file tree".
//
// The hook reads the currently active editor tab for `tabKey`; when it is a
// file tab it exposes its path (and canLocateFile=true) so the Files panel can
// run the SAME selection flow as a manual click (handleSelectNode + parent
// expansion). Locating is just "auto-finding" — everything after reuses the
// click-selection path instead of a separate active-file highlight.
import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { useEditorStore } from '@/shared/store';
import type { Tab } from '@/shared/types';

import { useLocateFileInTree } from '../useLocateFileInTree';

function makeFileTab(id: string, filePath: string): Tab {
  return {
    id,
    projectId: 'p1',
    title: filePath,
    order: 0,
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
    projectId: 'p1',
    title: id,
    order: 0,
    data: { kind: 'terminal', agentId: null, status: 'Idle' },
  };
}

describe('useLocateFileInTree', () => {
  beforeEach(() => {
    useEditorStore.setState({ tabs: {}, editorLayout: {}, activeTabId: null });
  });

  it('active file tab → canLocate true and exposes its path', () => {
    useEditorStore.setState({
      tabs: {
        p1: { tabs: [makeFileTab('t1', 'src/hooks/useFilePanelState.ts')], activeTabId: 't1' },
      },
      activeTabId: 't1',
    });

    const { result } = renderHook(() => useLocateFileInTree('p1'));
    expect(result.current.canLocateFile).toBe(true);
    expect(result.current.filePath).toBe('src/hooks/useFilePanelState.ts');
  });

  it('active terminal tab → canLocate false, filePath null', () => {
    useEditorStore.setState({
      tabs: { p1: { tabs: [makeTerminalTab('t1')], activeTabId: 't1' } },
      activeTabId: 't1',
    });

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
