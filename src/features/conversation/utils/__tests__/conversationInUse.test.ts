import { describe, expect, it } from 'vitest';

import {
  conversationViewerTabRefs,
  flattenTabSpaces,
  isConversationLiveInChat,
} from '@/features/conversation/utils/conversationInUse';
import type { Tab } from '@/shared/types';

const meta = { id: 'pi:abc123', nativeSessionId: 'abc123' };

function conversationTab(conversationId: string, id = 'tab-conv'): Tab {
  return {
    id,
    scope: { kind: 'app' },
    title: 'conversation',
    data: { kind: 'conversation', conversationId },
  };
}

function chatTab(data: {
  sessionId?: string;
  resumeConversationId?: string;
  resumeNativeSessionId?: string;
}): Tab {
  return {
    id: 'tab-chat',
    scope: { kind: 'app' },
    title: 'chat',
    data: { kind: 'agent-chat', agentId: 'pi', ...data },
  };
}

function terminalTab(): Tab {
  return {
    id: 'tab-term',
    scope: { kind: 'app' },
    title: 'term',
    data: { kind: 'terminal', agentId: 'pi', status: 'Idle' },
  };
}

describe('isConversationLiveInChat', () => {
  /**
   * **只读查看器不算使用中**（2026-10-30 实测：pi 会话点开查看器后再删除，被误判挡住）。
   * 用户点开一行才看得见它；把它算作「使用中」等于让删除永远不可用。
   *
   * 变异验证：把 `conversation` tab 也算进判定 → 本用例红。
   */
  it('does not treat a read-only conversation viewer as in use', () => {
    expect(isConversationLiveInChat([conversationTab('pi:abc123')], meta)).toBe(false);
  });

  it('detects an agent-chat tab restored from history (resumeConversationId)', () => {
    expect(isConversationLiveInChat([chatTab({ resumeConversationId: 'pi:abc123' })], meta)).toBe(
      true,
    );
  });

  /**
   * `resumeNativeSessionId` / `sessionId` 是**原生** id（不带 agent 前缀）：
   * 用 `meta.id` 比较会永远不命中 —— 删掉正在跑的会话，正是这条要防的事故。
   *
   * 变异验证：把这两个比较改成 `meta.id` → 本用例红。
   */
  it('detects an agent-chat tab by native session id', () => {
    expect(isConversationLiveInChat([chatTab({ resumeNativeSessionId: 'abc123' })], meta)).toBe(
      true,
    );
    expect(isConversationLiveInChat([chatTab({ sessionId: 'abc123' })], meta)).toBe(true);
  });

  it('does not match a different native session id', () => {
    expect(isConversationLiveInChat([chatTab({ resumeNativeSessionId: 'zzz' })], meta)).toBe(false);
    expect(isConversationLiveInChat([chatTab({ sessionId: 'zzz' })], meta)).toBe(false);
  });

  it('ignores unrelated tab kinds and empty tab lists', () => {
    expect(isConversationLiveInChat([], meta)).toBe(false);
    expect(isConversationLiveInChat([terminalTab()], meta)).toBe(false);
  });
});

describe('conversationViewerTabRefs', () => {
  /**
   * 删除成功后要关掉查看器 tab（文件没了，留着就是打不开的面板）。
   * 必须返回**空间键**：`editorStore.tabs` 按 tab 空间分键，同一会话可能在别的
   * workspace / worktree 里也开着 —— 只关当前空间会漏。
   *
   * 变异验证：只遍历当前空间 / 丢掉 `spaceKey` → 本用例红。
   */
  it('locates viewer tabs across every tab space with their space key', () => {
    const refs = conversationViewerTabRefs(
      {
        workspaceA: { tabs: [conversationTab('pi:abc123', 'tab-a'), terminalTab()] },
        workspaceB: { tabs: [conversationTab('pi:abc123', 'tab-b')] },
        workspaceC: { tabs: [conversationTab('pi:other', 'tab-c')] },
        missing: undefined,
      },
      meta,
    );

    expect(refs).toEqual([
      { spaceKey: 'workspaceA', tabId: 'tab-a' },
      { spaceKey: 'workspaceB', tabId: 'tab-b' },
    ]);
  });

  it('returns nothing when the conversation is not open in a viewer', () => {
    expect(conversationViewerTabRefs({ workspaceA: { tabs: [terminalTab()] } }, meta)).toEqual([]);
  });
});

describe('flattenTabSpaces', () => {
  it('flattens every tab space, skipping missing ones', () => {
    const tabs = flattenTabSpaces({
      workspaceA: { tabs: [terminalTab()] },
      workspaceB: { tabs: [chatTab({ resumeNativeSessionId: 'abc123' })] },
      missing: undefined,
    });
    expect(tabs).toHaveLength(2);
    expect(isConversationLiveInChat(tabs, meta)).toBe(true);
  });
});
