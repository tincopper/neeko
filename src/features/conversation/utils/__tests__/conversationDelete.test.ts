import { describe, expect, it, vi } from 'vitest';

import type { ConversationMeta } from '@/features/conversation/types';
import {
  buildDeleteConfirmRequest,
  canDeleteConversation,
  describeDeleteError,
  runConversationDelete,
} from '@/features/conversation/utils/conversationDelete';
import type { Tab } from '@/shared/types';

function createMeta(overrides: Partial<ConversationMeta> = {}): ConversationMeta {
  return {
    id: 'codex:uuid-1',
    nativeSessionId: 'uuid-1',
    agentId: 'codex',
    title: 'Refactor the auth module',
    startedAt: 0,
    updatedAt: 0,
    messageCount: 2,
    preview: '',
    filePath: '/home/u/.codex/sessions/2026/rollout-1.jsonl',
    projectPath: '/tmp/project',
    userTitle: null,
    tags: [],
    supportsResume: true,
    deleteSupport: 'native',
    ...overrides,
  };
}

function openConversationTab(id: string): Tab {
  return {
    id: 'tab-conv',
    scope: { kind: 'app' },
    title: 'conversation',
    data: { kind: 'conversation', conversationId: id },
  };
}

function liveChatTab(nativeSessionId: string): Tab {
  return {
    id: 'tab-chat',
    scope: { kind: 'app' },
    title: 'chat',
    data: { kind: 'agent-chat', agentId: 'codex', resumeNativeSessionId: nativeSessionId },
  };
}

function createDeps(overrides: Partial<Parameters<typeof runConversationDelete>[1]> = {}) {
  return {
    tabs: [] as Tab[],
    showToast: vi.fn(),
    confirm: vi.fn(async () => true),
    deleteConversation: vi.fn(async () => undefined),
    agentName: 'Codex',
    trace: vi.fn(),
    ...overrides,
  };
}

describe('canDeleteConversation', () => {
  /**
   * 三态 → 入口显隐。`unsupported` 与**缺失**（旧载荷 / 旧磁盘索引）都不显示：
   * 变异验证：把判断改成 `meta.deleteSupport !== 'unsupported'` → 缺失用例红。
   */
  it('shows the entry for native and storage only', () => {
    expect(canDeleteConversation({ deleteSupport: 'native' })).toBe(true);
    expect(canDeleteConversation({ deleteSupport: 'storage' })).toBe(true);
    expect(canDeleteConversation({ deleteSupport: 'unsupported' })).toBe(false);
    expect(canDeleteConversation({})).toBe(false);
  });
});

describe('buildDeleteConfirmRequest', () => {
  it('names the agent, the conversation and the delegated CLI action', () => {
    const request = buildDeleteConfirmRequest(createMeta(), 'Codex');
    expect(request.title).toBe('Delete conversation?');
    expect(request.danger).toBe(true);
    expect(request.confirmLabel).toBe('Delete');
    expect(request.message).toContain('Codex');
    expect(request.message).toContain('Refactor the auth module');
    expect(request.message).toContain('its own CLI');
    expect(request.message).toContain('cannot be undone');
  });

  /**
   * `storage` 必须把**真实路径**摆给用户看（不可恢复的操作，目标要可核对）。
   *
   * 变异验证：把 storage 分支也写成「用 CLI」→ 本用例红。
   */
  it('shows the storage path for adapter-side deletion', () => {
    const request = buildDeleteConfirmRequest(
      createMeta({ deleteSupport: 'storage', filePath: '/home/u/.pi/agent/sessions/x/s.jsonl' }),
      'Pi',
    );
    expect(request.message).toContain('/home/u/.pi/agent/sessions/x/s.jsonl');
    expect(request.message).not.toContain('its own CLI');
  });

  /**
   * 活 chat 会话不再被硬挡住，但**必须在文案里说清「那个 tab 会被一起关掉」**：
   * 用户不该点完才发现还有东西被关。
   *
   * 变异验证：去掉 `liveInChat` 分支 → 本用例红。
   */
  it('warns that an Agent Chat tab will be closed with it', () => {
    const request = buildDeleteConfirmRequest(createMeta(), 'Pi', { liveInChat: true });
    expect(request.message).toContain('open in Agent Chat');
    expect(request.message).toContain('closed too');
    expect(buildDeleteConfirmRequest(createMeta(), 'Pi').message).not.toContain('Agent Chat');
  });

  it('prefers the user title and falls back to the agent id', () => {
    const request = buildDeleteConfirmRequest(
      createMeta({ userTitle: 'My  renamed\n title' }),
      null,
    );
    expect(request.message).toContain('My renamed title');
    expect(request.message).toContain('codex');
  });
});

describe('describeDeleteError', () => {
  it('unwraps string / Error / object rejections', () => {
    expect(describeDeleteError('Agent error: exit 7')).toBe('Agent error: exit 7');
    expect(describeDeleteError(new Error('boom'))).toBe('boom');
    expect(describeDeleteError({ message: 'Not found: x' })).toBe('Not found: x');
    expect(describeDeleteError(undefined)).toBe('Failed to delete conversation');
  });

  /**
   * **`AppError` 是 serde 外部标签枚举**：`AppError::InvalidInput("…")` 跨 IPC 变成
   * `{"InvalidInput":"…"}`。旧实现只认字符串/`{message}`，把它整条丢成通用文案 ——
   * 2026-10-30 实测：用户看到红色 toast 却拿不到任何原因。
   *
   * 变异验证：删掉单键分支 → 本用例红（三条断言全变成通用文案）。
   */
  it('unwraps serde externally-tagged AppError objects', () => {
    expect(describeDeleteError({ InvalidInput: 'Refusing to delete /x — outside root' })).toBe(
      'InvalidInput: Refusing to delete /x — outside root',
    );
    expect(describeDeleteError({ Agent: 'pi delete failed (exit 7): boom' })).toBe(
      'Agent: pi delete failed (exit 7): boom',
    );
    expect(describeDeleteError({ NotFound: 'Conversation not found: pi:x' })).toContain(
      'Conversation not found',
    );
  });

  it('keeps the generic message for shapes it cannot interpret', () => {
    expect(describeDeleteError({ weird: { nested: 1 } })).toBe('Failed to delete conversation');
  });
});

describe('runConversationDelete', () => {
  /**
   * **活 Agent Chat 会话不再是一条死路**（2026-10-30 第二次实测：上一版让用户
   * 「自己找到并关掉那个 tab 再来」，用户根本看不出是哪个 tab → 表现为「点了没反应」）。
   *
   * 现在的形状：确认框里说清「那个 chat tab 会被一起关掉」→ 删 → 关 tab。
   *
   * 变异验证：把 `liveInChat` 真的判成阻断（提前 return false）→ 本用例红。
   */
  it('deletes a conversation that is still open in Agent Chat, closing the tab after', async () => {
    const closeTabs = vi.fn();
    const deps = createDeps({ tabs: [liveChatTab('uuid-1')], closeTabs });

    await expect(runConversationDelete(createMeta(), deps)).resolves.toBe(true);

    expect(deps.confirm).toHaveBeenCalledTimes(1);
    const request = vi.mocked(deps.confirm).mock.calls[0][0];
    expect(request.message).toContain('open in Agent Chat');
    expect(deps.deleteConversation).toHaveBeenCalledWith('codex:uuid-1');
    expect(closeTabs).toHaveBeenCalledTimes(1);
  });

  /**
   * **只读查看器 tab 不阻�断**（2026-10-30 实测：pi 删除被这条误判挡住）。
   *
   * 用户在面板里点一行才看得见它 —— 把「正在看」当成「正在用」，等于让功能永远不可用。
   *
   * 变异验证：把 `conversation` tab 也算进 live 判定 → 文案里出现 Agent Chat，本用例红。
   */
  it('allows deletion while only a read-only viewer tab is open', async () => {
    const deps = createDeps({ tabs: [openConversationTab('codex:uuid-1')] });

    await expect(runConversationDelete(createMeta(), deps)).resolves.toBe(true);

    const request = vi.mocked(deps.confirm).mock.calls[0][0];
    expect(request.message).not.toContain('Agent Chat');
    expect(deps.deleteConversation).toHaveBeenCalledWith('codex:uuid-1');
  });

  /**
   * **失败时不许关 tab**：删除没成功，用户还要继续看那份仍存在的会话。
   *
   * 变异验证：把 `closeTabs` 挪到 try 之前 / catch 之外 → 本用例红。
   */
  it('keeps tabs open when the delete fails', async () => {
    const closeTabs = vi.fn();
    const deps = createDeps({
      tabs: [liveChatTab('uuid-1')],
      closeTabs,
      deleteConversation: vi.fn(async () => {
        throw new Error('File error: Failed to delete file: Permission denied');
      }),
    });

    await expect(runConversationDelete(createMeta(), deps)).resolves.toBe(false);

    expect(closeTabs).not.toHaveBeenCalled();
    expect(deps.showToast).toHaveBeenCalledWith(
      'File error: Failed to delete file: Permission denied',
      'error',
    );
  });

  /**
   * 失败原因必须同时落到后端日志（`reportError`）：toast 一闪而过，用户回述时信息已丢。
   *
   * 变异验证：删掉 `deps.reportError?.(reason)` → 本用例红。
   */
  it('reports the failure reason to the backend log', async () => {
    const reportError = vi.fn();
    const deps = createDeps({
      reportError,
      deleteConversation: vi.fn(async () => {
        throw { InvalidInput: 'Refusing to delete /x — outside the `pi` session root' };
      }),
    });

    await expect(runConversationDelete(createMeta(), deps)).resolves.toBe(false);

    expect(reportError).toHaveBeenCalledWith(
      'InvalidInput: Refusing to delete /x — outside the `pi` session root',
    );
  });

  it('does nothing when the user cancels the confirmation', async () => {
    const deps = createDeps({ confirm: vi.fn(async () => false) });

    await expect(runConversationDelete(createMeta(), deps)).resolves.toBe(false);

    expect(deps.deleteConversation).not.toHaveBeenCalled();
    expect(deps.showToast).not.toHaveBeenCalled();
  });

  /**
   * **阶段埋点**：`requested → confirmed → invoking → deleted`。
   *
   * 「点了没反应」的三种成因（没走到 / 确认框没弹 / 弹了没结算）在屏幕上完全一样，
   * 只有埋点能把它们分开 —— 这是一个破坏性动作的最小可观测性。
   *
   * 变异验证：删掉任意一条 `deps.trace?.(...)` → 本用例红。
   */
  it('traces every stage of the flow', async () => {
    const deps = createDeps();

    await runConversationDelete(createMeta(), deps);

    expect(vi.mocked(deps.trace!).mock.calls.map(([step]) => step)).toEqual([
      'requested',
      'confirmed',
      'invoking',
      'deleted',
    ]);
  });

  it('traces a cancellation instead of deleting', async () => {
    const deps = createDeps({ confirm: vi.fn(async () => false) });

    await runConversationDelete(createMeta(), deps);

    expect(vi.mocked(deps.trace!).mock.calls.map(([step]) => step)).toEqual([
      'requested',
      'cancelled',
    ]);
    expect(deps.deleteConversation).not.toHaveBeenCalled();
  });

  it('deletes and reports success after confirmation', async () => {
    const deps = createDeps();

    await expect(runConversationDelete(createMeta(), deps)).resolves.toBe(true);

    expect(deps.deleteConversation).toHaveBeenCalledWith('codex:uuid-1');
    expect(deps.showToast).toHaveBeenCalledWith('Conversation deleted', 'info');
  });

  /**
   * 失败必须返回 `false` 并把**真实原因**抛给 toast（AC7：可归因，不乐观移除）。
   *
   * 变异验证：把 catch 分支改成 `return true` → 两条断言都红。
   */
  it('surfaces the backend error and reports failure', async () => {
    const deps = createDeps({
      deleteConversation: vi.fn(async () => {
        throw 'Agent error: delete failed (exit 7): no such session';
      }),
    });

    await expect(runConversationDelete(createMeta(), deps)).resolves.toBe(false);

    expect(deps.showToast).toHaveBeenCalledWith(
      'Agent error: delete failed (exit 7): no such session',
      'error',
    );
    expect(deps.showToast).not.toHaveBeenCalledWith('Conversation deleted', 'info');
  });
});
