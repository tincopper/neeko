/**
 * taskTerminal 端口（F2）：配额/ID/排序收敛 terminal 域 —— editor 侧只调它，不手造 Tab。
 */
import { beforeEach, describe, expect, it } from 'vitest';

import { useEditorStore } from '@/shared/store/editorStore';

import { MAX_TERMINAL_TABS, createTaskTerminal } from '../taskTerminal';

const PROJECT_ID = 'task-terminal-test';

describe('createTaskTerminal', () => {
  beforeEach(() => {
    useEditorStore.setState({ tabs: {}, activeTabId: null });
  });

  it('创建 terminal tab 并携带 taskCommand，随即激活', () => {
    const ok = createTaskTerminal(PROJECT_ID, {
      agentId: 'opencode',
      agentName: 'OpenCode',
      taskCommand: "opencode --prompt 'fix it'",
    });

    expect(ok).toBe(true);
    const projectTabs = useEditorStore.getState().tabs[PROJECT_ID];
    expect(projectTabs.tabs).toHaveLength(1);
    const tab = projectTabs.tabs[0];
    expect(tab.data.kind).toBe('terminal');
    if (tab.data.kind === 'terminal') {
      expect(tab.data.agentId).toBe('opencode');
      expect(tab.data.taskCommand).toBe("opencode --prompt 'fix it'");
    }
    expect(tab.title).toBe('OpenCode');
    expect(projectTabs.activeTabId).toBe(tab.id);
  });

  it('无 agentName 时标题回落 agentId', () => {
    createTaskTerminal(PROJECT_ID, { agentId: 'claude', taskCommand: 'claude hi' });
    const tab = useEditorStore.getState().tabs[PROJECT_ID].tabs[0];
    expect(tab.title).toBe('claude');
  });

  it('配额满（MAX_TERMINAL_TABS）时返回 false 且不再建 tab', () => {
    for (let i = 0; i < MAX_TERMINAL_TABS; i++) {
      expect(createTaskTerminal(PROJECT_ID, { agentId: 'a', taskCommand: `cmd ${i}` })).toBe(true);
    }
    expect(createTaskTerminal(PROJECT_ID, { agentId: 'a', taskCommand: 'one more' })).toBe(false);
    expect(useEditorStore.getState().tabs[PROJECT_ID].tabs).toHaveLength(MAX_TERMINAL_TABS);
  });
});
