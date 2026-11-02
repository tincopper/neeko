// @vitest-environment node
/**
 * agent-chat tab 的创建端口：id / scope / 占位标题 / 创建即激活，以及 data 的透传。
 *
 * 这些断言值在「四份手抄收成一处」之后才可能成立 —— 之前每个调用点各写一遍，
 * 谁漏了 `activateTab`、谁把 `resumeConversationId` 写丢，都没有统一的地方可测。
 */
import { beforeEach, describe, expect, it } from 'vitest';

import { useEditorStore } from '@/shared/store/editorStore';
import { WorkspaceSession } from '@/shared/utils/workspaceRef';

import { openAgentChatTab } from '../openChatTab';

const WS = WorkspaceSession.of('p1', '/proj-wt');

function tabs() {
  return useEditorStore.getState().tabs[WS.key]?.tabs ?? [];
}

beforeEach(() => {
  useEditorStore.setState({ tabs: {}, editorLayout: {} });
});

describe('openAgentChatTab', () => {
  it('建一条空 chat tab 并激活在当前单元', () => {
    const tabId = openAgentChatTab(WS);

    const [tab] = tabs();
    expect(tab.id).toBe(tabId);
    expect(tab.title).toBe('Agent Chat');
    expect(tab.scope).toEqual({ kind: 'workspace', session: WS });
    expect(tab.data).toEqual({ kind: 'agent-chat', agentId: undefined });
    // 创建即激活：新 tab 落在左组且是当前项（`addTab` 的 ensureLayout 契约）。
    expect(useEditorStore.getState().editorLayout[WS.key]?.groups.left.activeTabId).toBe(tabId);
  });

  it('agent + 占位标题透传', () => {
    openAgentChatTab(WS, { agentId: 'pi', title: '恢复：登录竞态' });

    const [tab] = tabs();
    expect(tab.title).toBe('恢复：登录竞态');
    expect(tab.data.kind === 'agent-chat' && tab.data.agentId).toBe('pi');
  });

  it('Histor 恢复目标写进 data，`kind` 不可被覆盖', () => {
    openAgentChatTab(WS, {
      agentId: 'claude-code',
      data: {
        sessionId: undefined,
        resumeConversationId: 'conv-1',
        resumeNativeSessionId: 'native-1',
        // 调用方即使塞了 kind 也不生效：tab 的类型由端口决定。
        kind: 'terminal' as never,
      },
    });

    const [tab] = tabs();
    expect(tab.data).toEqual({
      kind: 'agent-chat',
      agentId: 'claude-code',
      resumeConversationId: 'conv-1',
      resumeNativeSessionId: 'native-1',
    });
  });

  it('每条 tab 的 id 唯一', () => {
    const first = openAgentChatTab(WS);
    const second = openAgentChatTab(WS);
    expect(first).not.toBe(second);
    expect(tabs()).toHaveLength(2);
  });
});
