import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useProjectStore } from '@/shared/store/projectStore';
import type { ConversationMeta } from '@/shared/types/session';
import type { ProjectId } from '@/shared/utils/workspaceRef';
import { createProject } from '@/testing/factories';

import { useChatRestore } from '../useChatRestore';

/**
 * 空聊天「最近会话」列表的过滤条件：
 * **有 `nativeSessionId` 且该 agent 支持 chat 恢复**。
 *
 * 只按 `nativeSessionId` 过滤会列出 claude-code / codex 这类「CLI 能 `--resume`，
 * 但 chat 侧没有恢复实现」的会话 —— 点进去只会得到一句
 * `does not support resuming into Agent Chat`（死入口）。
 */

const { listConversationsMock, supportsMock } = vi.hoisted(() => ({
  listConversationsMock:
    vi.fn<(path?: string, agentId?: string, opts?: unknown) => Promise<unknown>>(),
  supportsMock: vi.fn<(agentId: string) => Promise<boolean>>(),
}));

vi.mock('@/features/conversation/api/conversationApi', () => ({
  listConversations: listConversationsMock,
  getConversationMessages: vi.fn(),
}));

vi.mock('../../utils/chatResumeSupport', () => ({
  supportsChatResume: supportsMock,
}));

function conv(agentId: string, nativeSessionId: string): ConversationMeta {
  return {
    id: `${agentId}:${nativeSessionId}`,
    nativeSessionId,
    agentId,
    title: `${agentId} conversation`,
    startedAt: 1,
    updatedAt: 1,
    messageCount: 2,
    preview: 'hi',
    filePath: `/sessions/${agentId}/${nativeSessionId}.jsonl`,
    projectPath: '/p1',
    userTitle: null,
    tags: [],
    supportsResume: true,
  };
}

function renderRestore() {
  return renderHook(() =>
    useChatRestore({
      projectId: 'p1' as ProjectId,
      tabKey: 'p1',
      tabId: 'tab-1',
      fallbackAgentId: 'pi',
      resumeConversationId: undefined,
      resumeNativeSessionId: undefined,
      messageCount: 0,
      setMessages: () => {},
      setSelectedModel: () => {},
      sessionIdRef: { current: undefined },
      primeAgentBaseline: () => {},
    }),
  );
}

describe('useChatRestore.loadResumableList', () => {
  beforeEach(() => {
    listConversationsMock.mockReset();
    supportsMock.mockReset();

    const project = createProject({ id: 'p1' as ProjectId, path: '/p1' });
    useProjectStore.setState({
      projects: [project],
      activeProjectId: project.id,
      activeProject: project,
    });
  });

  it('keeps only conversations whose agent supports chat resume', async () => {
    listConversationsMock.mockResolvedValue({
      items: [conv('pi', 'n1'), conv('codex', 'n2'), conv('opencode', 'n3')],
      total: 3,
      offset: 0,
      limit: 20,
      hasMore: false,
    });
    supportsMock.mockImplementation(async (id: string) => id !== 'codex');

    const { result } = renderRestore();
    await act(async () => {
      await result.current.loadResumableList();
    });

    expect(result.current.resumableList.map((c) => c.agentId)).toEqual(['pi', 'opencode']);
  });

  /** 没有原生会话 id 的条目**仍然**被过滤（既有的必要条件不因本次改动回退）。 */
  it('still drops conversations without a native session id', async () => {
    listConversationsMock.mockResolvedValue({
      items: [conv('pi', ''), conv('pi', 'n2')],
      total: 2,
      offset: 0,
      limit: 20,
      hasMore: false,
    });
    supportsMock.mockResolvedValue(true);

    const { result } = renderRestore();
    await act(async () => {
      await result.current.loadResumableList();
    });

    expect(result.current.resumableList.map((c) => c.nativeSessionId)).toEqual(['n2']);
    // 没有 id 的条目不该白问一次能力 —— 先按 id 过滤，再问 agent。
    expect(supportsMock).toHaveBeenCalledTimes(1);
  });

  it('yields an empty list when the capability query says no', async () => {
    listConversationsMock.mockResolvedValue({
      items: [conv('claude-code', 'n1')],
      total: 1,
      offset: 0,
      limit: 20,
      hasMore: false,
    });
    supportsMock.mockResolvedValue(false);

    const { result } = renderRestore();
    await act(async () => {
      await result.current.loadResumableList();
    });

    expect(result.current.resumableList).toEqual([]);
    expect(result.current.resumableLoading).toBe(false);
  });

  /** 列表查询失败不抛：空列表 + 结束 loading（与改动前一致）。 */
  it('degrades to an empty list when the query fails', async () => {
    listConversationsMock.mockRejectedValue(new Error('scan failed'));
    supportsMock.mockResolvedValue(true);

    const { result } = renderRestore();
    await act(async () => {
      await result.current.loadResumableList();
    });

    expect(result.current.resumableList).toEqual([]);
    expect(result.current.resumableLoading).toBe(false);
  });
});
