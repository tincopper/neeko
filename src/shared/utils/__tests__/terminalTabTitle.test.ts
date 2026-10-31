import { describe, expect, it } from 'vitest';

import type { Tab } from '@/shared/types/tab';
import { nextTerminalTitle } from '@/shared/utils/terminalTabTitle';

function tab(kind: Tab['data']['kind'], title: string): Tab {
  return {
    id: `tab-${title}`,
    scope: { kind: 'workspace', session: { projectId: 'p1', worktreePath: null } } as never,
    title,
    data: kind === 'terminal' ? { kind: 'terminal', agentId: null } : ({ kind } as never),
  };
}

describe('nextTerminalTitle', () => {
  it('空空间 ⇒ Terminal 1', () => {
    expect(nextTerminalTitle(undefined)).toBe('Terminal 1');
    expect(nextTerminalTitle({ tabs: [] })).toBe('Terminal 1');
  });

  it('只数终端 tab：文件 / 浏览器 tab 不参与编号', () => {
    const tabs = [tab('terminal', 'Terminal 1'), tab('file', 'a.ts'), tab('browser', 'Browser')];
    expect(nextTerminalTitle({ tabs })).toBe('Terminal 2');
  });

  it('不含 agent 名 / 项目名：标题只说「第几个终端」', () => {
    const tabs = [tab('terminal', 'Terminal 1'), tab('terminal', 'Terminal 2')];
    const title = nextTerminalTitle({ tabs });
    expect(title).toBe('Terminal 3');
    expect(title).not.toMatch(/pi|opencode|neeko/i);
  });
});
