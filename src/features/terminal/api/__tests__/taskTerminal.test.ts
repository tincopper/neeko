// @vitest-environment node
/**
 * taskTerminal 端口（F2）：配额/ID/排序收敛 terminal 域 —— editor 侧只调它，不手造 Tab。
 */
import { beforeEach, describe, expect, it } from 'vitest';

import { activeTabIdOf, useEditorStore } from '@/shared/store/editorStore';
import { WorkspaceSession } from '@/shared/utils/workspaceRef';

import { MAX_TERMINAL_TABS, createTaskTerminal } from '../taskTerminal';

const PROJECT_ID = 'task-terminal-test';

const SPACE = WorkspaceSession.of(PROJECT_ID, null).key;

describe('createTaskTerminal', () => {
  beforeEach(() => {
    useEditorStore.setState({ tabs: {}, editorLayout: {} });
  });

  it('创建 terminal tab 并携带 taskCommand，随即激活', () => {
    const ok = createTaskTerminal(PROJECT_ID, {
      agentId: 'opencode',
      taskCommand: "opencode --prompt 'fix it'",
    });

    expect(ok).toBe(true);
    const projectTabs = useEditorStore.getState().tabs[SPACE];
    expect(projectTabs.tabs).toHaveLength(1);
    const tab = projectTabs.tabs[0];
    expect(tab.data.kind).toBe('terminal');
    if (tab.data.kind === 'terminal') {
      expect(tab.data.agentId).toBe('opencode');
      expect(tab.data.taskCommand).toBe("opencode --prompt 'fix it'");
    }
    // 标题是中性占位（agent 由 tab 前导图标表达），真实标题由注册表在 prompt 到达后升级
    expect(tab.title).toBe('Terminal 1');
    expect(activeTabIdOf(SPACE)).toBe(tab.id);
  });

  it('标题不回落 agentId：agent 名/id 都不是标题', () => {
    createTaskTerminal(PROJECT_ID, { agentId: 'claude', taskCommand: 'claude hi' });
    const tab = useEditorStore.getState().tabs[SPACE].tabs[0];
    expect(tab.title).toBe('Terminal 1');
    expect(tab.title).not.toBe('claude');
  });

  it('配额满（MAX_TERMINAL_TABS）时返回 false 且不再建 tab', () => {
    for (let i = 0; i < MAX_TERMINAL_TABS; i++) {
      expect(createTaskTerminal(PROJECT_ID, { agentId: 'a', taskCommand: `cmd ${i}` })).toBe(true);
    }
    expect(createTaskTerminal(PROJECT_ID, { agentId: 'a', taskCommand: 'one more' })).toBe(false);
    expect(useEditorStore.getState().tabs[SPACE].tabs).toHaveLength(MAX_TERMINAL_TABS);
  });
});
