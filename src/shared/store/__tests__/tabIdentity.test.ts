// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest';

import { useEditorStore } from '@/shared/store/editorStore';
import type { Tab, TabData } from '@/shared/types';
import { tabProjectId, tabSpaceKeyOf } from '@/shared/utils/tabIdentity';
import { WorkspaceSession, WORKSPACE_KEY_SEP } from '@/shared/utils/workspaceRef';

/**
 * Tab 身份模型不变量（PRD 4.2）：
 * - 构造律 P3：store 键由 `tab.scope` 推导，与 tab 携带身份恒一致；
 * - 8 个 tab kind 全部经 scope 取身份（不再有顶层 `projectId`）；
 * - `{ kind: 'app' }` 落 `__app__` 空间（P4 层级归位）。
 */

const P1_MAIN = WorkspaceSession.of('p1', null);
const SPACE = P1_MAIN.key;

/** 为每个 TabData kind 造一个最小合法 data（键由 scope 推导，与 data 形状无关）。 */
function dataOf(kind: TabData['kind']): TabData {
  switch (kind) {
    case 'terminal':
      return { kind: 'terminal', agentId: null, status: 'Idle' };
    case 'file':
      return {
        kind: 'file',
        filePath: 'a.ts',
        fileName: 'a.ts',
        content: { path: 'a.ts', content: '', size: 0, is_binary: false },
        isDirty: false,
      };
    case 'diff':
      return {
        kind: 'diff',
        filePath: 'a.ts',
        fileName: 'a.ts',
        diffSource: { type: 'local', projectId: 'p1' },
      };
    case 'html-preview':
      return { kind: 'html-preview', filePath: 'a.html', fileName: 'a.html' };
    case 'conversation':
      return { kind: 'conversation', conversationId: 'c1' };
    case 'prDetail':
      return {
        kind: 'prDetail',
        projectId: 'p1',
        prNumber: 1,
        prTitle: 't',
        prState: 'open',
        prBody: null,
        prAuthor: 'a',
        prCreatedAt: '',
        prUrl: '',
        prHeadRef: 'h',
        prBaseRef: 'b',
      };
    case 'browser':
      return { kind: 'browser', url: '' };
    case 'agent-chat':
      return { kind: 'agent-chat' };
  }
}

const KINDS: TabData['kind'][] = [
  'terminal',
  'file',
  'diff',
  'html-preview',
  'conversation',
  'prDetail',
  'browser',
  'agent-chat',
];

function makeTab(kind: TabData['kind'], id = `tab-${kind}`): Tab {
  return {
    id,
    scope: { kind: 'workspace', session: P1_MAIN },
    title: kind,
    order: 0,
    data: dataOf(kind),
  };
}

describe('Tab 身份模型 — 构造律与键-身份一致性', () => {
  beforeEach(() => {
    useEditorStore.setState({ tabs: {}, editorLayout: {}, activeTabId: null });
  });

  it.each(KINDS)('kind=%s：store 键 = tab.scope 推导键，且命中该 tab', (kind) => {
    const tab = makeTab(kind);
    useEditorStore.getState().addTab(tab);

    const key = tabSpaceKeyOf(tab.scope);
    expect(key).toBe(SPACE);
    const stored = useEditorStore.getState().tabs[key]?.tabs ?? [];
    expect(stored.some((t) => t.id === tab.id)).toBe(true);
    // 键与 tab 携带身份一致（不是「键 A、身份 B」）
    expect(stored.find((t) => t.id === tab.id)?.scope).toEqual(tab.scope);
  });

  it('worktree 单元：键 = session.key（含 worktree 分量），与携带身份一致', () => {
    const session = WorkspaceSession.of('p1', '/wt/a');
    useEditorStore
      .getState()
      .addTab({ ...makeTab('browser', 'wt-tab'), scope: { kind: 'workspace', session } });

    expect(Object.keys(useEditorStore.getState().tabs)).toEqual([session.key]);
    expect(session.key).toContain('/wt/a');
    expect(useEditorStore.getState().tabs[session.key]?.tabs[0].scope).toEqual({
      kind: 'workspace',
      session,
    });
  });

  it('{ kind: app }：落 __app__ 空间，无项目身份', () => {
    useEditorStore.getState().addTab({ ...makeTab('file', 'app-tab'), scope: { kind: 'app' } });

    expect(useEditorStore.getState().tabs.__app__?.tabs.map((t) => t.id)).toEqual(['app-tab']);
    expect(tabProjectId(useEditorStore.getState().tabs.__app__!.tabs[0])).toBeNull();
  });

  it('回归：agent 点击路径创建的 terminal tab，身份不含 NUL（check_agents_installed 收到裸 projectId）', () => {
    // 复现原事故：点击 agent → 新建 terminal tab → pane 用 tab 身份调 check_agents_installed。
    // 旧实现把「复合 WorkspaceKey」写进 tab.projectId → 后端 Project not found。
    const tab = makeTab('terminal', 'agent-tab');
    useEditorStore.getState().addTab(tab);

    const projectIdForCheck = tabProjectId(tab);
    expect(projectIdForCheck).toBe('p1');
    expect(projectIdForCheck).not.toContain(WORKSPACE_KEY_SEP);
    // 而 store 键确实是复合键（索引），二者是不同维度、不再混淆
    expect(tabSpaceKeyOf(tab.scope)).toBe(`p1${WORKSPACE_KEY_SEP}`);
  });
});
