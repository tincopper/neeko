import { beforeEach, describe, expect, it, vi } from 'vitest';

import { closeEditorTab } from '@/features/terminal';
import { useEditorStore } from '@/shared/store/editorStore';
import { useProjectStore } from '@/shared/store/projectStore';
import { useWorktreeStore } from '@/shared/store/worktreeStore';
import type { Tab } from '@/shared/types/tab';

import {
  closeActiveTabCommand,
  closeActiveTabForTabKey,
  resolveCurrentTabKey,
} from '../closeActiveTabCommand';

// mock 底层模块（门面 re-export 同源）：closeEditorTab 打桩，验证被调用的 tabKey/tabId
vi.mock('@/features/terminal/components/terminalTabCleanup', () => ({
  closeEditorTab: vi.fn(),
  closeAllEditorTabs: vi.fn(),
}));

const mockCloseEditorTab = vi.mocked(closeEditorTab);

function makeTab(id: string, projectId: string, title = id): Tab {
  return {
    id,
    projectId,
    title,
    order: 0,
    data: { kind: 'terminal', agentId: null, status: 'Idle' },
  };
}

describe('closeActiveTabCommand — Cmd+W 关闭当前激活 tab（根治竞态/脱节）', () => {
  beforeEach(() => {
    mockCloseEditorTab.mockClear();
    useEditorStore.setState({ tabs: {}, activeTabId: null, editorLayout: {} });
    useProjectStore.setState({ activeProjectId: null });
    useWorktreeStore.setState({ activeWorktreePath: null });
  });

  describe('resolveCurrentTabKey', () => {
    it('无项目 → 设置页 tab 空间', () => {
      expect(resolveCurrentTabKey()).toBe('__app__');
    });

    it('有项目无 worktree → 项目 id', () => {
      useProjectStore.setState({ activeProjectId: 'p1' });
      expect(resolveCurrentTabKey()).toBe('p1');
    });

    it('有项目且有 worktree → worktree 专属 tab 空间', () => {
      useProjectStore.setState({ activeProjectId: 'p1' });
      useWorktreeStore.setState({ activeWorktreePath: '/repo/wt' });
      expect(resolveCurrentTabKey()).toBe('p1:wt:/repo/wt');
    });
  });

  describe('closeActiveTabForTabKey', () => {
    it('关闭指定 tab 空间的激活 tab', () => {
      useEditorStore.setState({
        tabs: { p1: { tabs: [makeTab('t1', 'p1'), makeTab('t2', 'p1')], activeTabId: 't2' } },
      });
      const closed = closeActiveTabForTabKey('p1');
      expect(closed).toBe(true);
      expect(mockCloseEditorTab).toHaveBeenCalledWith('p1', 't2');
    });

    it('激活位为空 → 静默不关闭', () => {
      useEditorStore.setState({ tabs: { p1: { tabs: [makeTab('t1', 'p1')], activeTabId: null } } });
      expect(closeActiveTabForTabKey('p1')).toBe(false);
      expect(mockCloseEditorTab).not.toHaveBeenCalled();
    });

    it('tab 空间不存在 → 静默不关闭', () => {
      expect(closeActiveTabForTabKey('missing')).toBe(false);
      expect(mockCloseEditorTab).not.toHaveBeenCalled();
    });
  });

  describe('closeActiveTabCommand（事件处理器全链路）', () => {
    it('现取当前项目/tab 状态并关闭激活 tab', () => {
      useProjectStore.setState({ activeProjectId: 'p1' });
      useEditorStore.setState({
        tabs: { p1: { tabs: [makeTab('t1', 'p1')], activeTabId: 't1' } },
      });
      expect(closeActiveTabCommand()).toBe(true);
      expect(mockCloseEditorTab).toHaveBeenCalledWith('p1', 't1');
    });

    it('项目切换后全局 activeTabId 脱节时，仍按 per-tabKey 激活位关闭', () => {
      // 模拟「全局 activeTabId 被项目切换路径置空/错位、但 p1 有激活 tab」的竞态现场
      useProjectStore.setState({ activeProjectId: 'p1' });
      useEditorStore.setState({
        tabs: { p1: { tabs: [makeTab('t1', 'p1')], activeTabId: 't1' } },
        activeTabId: null, // 全局位被置空（setActiveProjectId 读到空槽的 `?? null`）
      });
      expect(closeActiveTabCommand()).toBe(true);
      expect(mockCloseEditorTab).toHaveBeenCalledWith('p1', 't1');
    });

    it('worktree 场景：关闭 worktree 专属 tab 空间的激活 tab', () => {
      useProjectStore.setState({ activeProjectId: 'p1' });
      useWorktreeStore.setState({ activeWorktreePath: '/repo/wt' });
      useEditorStore.setState({
        tabs: {
          'p1:wt:/repo/wt': { tabs: [makeTab('w1', 'p1')], activeTabId: 'w1' },
          p1: { tabs: [makeTab('m1', 'p1')], activeTabId: 'm1' },
        },
      });
      expect(closeActiveTabCommand()).toBe(true);
      expect(mockCloseEditorTab).toHaveBeenCalledWith('p1:wt:/repo/wt', 'w1');
    });
  });
});
