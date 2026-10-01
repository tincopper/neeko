import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PromptResource } from '@/shared/types/library';

import { useInsertPromptToWorkspace } from '../useInsertPromptToWorkspace';

const hoisted = vi.hoisted(() => ({
  toast: vi.fn(),
  clipboard: vi.fn(async (): Promise<boolean> => true),
  api: {
    current: {} as {
      insertToTerminal?: (t: string) => boolean;
      insertToAgentInput?: (t: string) => void;
    },
  },
}));

vi.mock('@/shared/contexts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/shared/contexts')>();
  return {
    ...actual,
    useTerminalInsert: () => ({ api: hoisted.api.current, register: vi.fn(() => () => {}) }),
    useAppContext: () => ({ showToast: hoisted.toast }),
  };
});

vi.mock('@/shared/hooks/useCopyToClipboard', () => ({
  useCopyToClipboard: () => hoisted.clipboard,
}));

const prompt: PromptResource = {
  id: 'p1',
  name: 'Review',
  content: 'review this diff',
  description: null,
  tags: [],
  scope: 'global',
  favorite: false,
  usageCount: 0,
  createdAt: 0,
  updatedAt: 0,
};

/**
 * 投递语义（terminal → agent → clipboard）的唯一实现点：状态栏、Library 面板、
 * 全局宿主三条入口共用，故每个降级分支都必须有断言 —— 分支走错 = 用户看到的行为不同。
 */
describe('useInsertPromptToWorkspace', () => {
  beforeEach(() => {
    hoisted.api.current = {};
    hoisted.toast.mockClear();
    hoisted.clipboard.mockClear();
  });

  it('terminal 目标且终端可用：写终端 + 成功 toast，不碰 agent / clipboard', async () => {
    const insertToTerminal = vi.fn(() => true);
    const insertToAgentInput = vi.fn();
    hoisted.api.current = { insertToTerminal, insertToAgentInput };
    const { result } = renderHook(() => useInsertPromptToWorkspace());

    result.current(prompt, 'terminal');
    await vi.waitFor(() => expect(hoisted.toast).toHaveBeenCalledTimes(1));

    expect(insertToTerminal).toHaveBeenCalledWith('review this diff');
    expect(insertToAgentInput).not.toHaveBeenCalled();
    expect(hoisted.clipboard).not.toHaveBeenCalled();
    expect(hoisted.toast).toHaveBeenCalledWith('Inserted "Review" to terminal', 'info');
  });

  it('terminal 目标但无活动终端：提示降级并转投 agent 输入', () => {
    const insertToTerminal = vi.fn(() => false);
    const insertToAgentInput = vi.fn();
    hoisted.api.current = { insertToTerminal, insertToAgentInput };
    const { result } = renderHook(() => useInsertPromptToWorkspace());

    result.current(prompt, 'terminal');

    expect(hoisted.toast).toHaveBeenCalledWith(
      'No active terminal — inserting to agent input',
      'info',
    );
    expect(insertToAgentInput).toHaveBeenCalledWith('review this diff');
    expect(hoisted.clipboard).not.toHaveBeenCalled();
  });

  it('agent 目标：直接写 agent 输入，零 toast', () => {
    const insertToAgentInput = vi.fn();
    hoisted.api.current = { insertToAgentInput };
    const { result } = renderHook(() => useInsertPromptToWorkspace());

    result.current(prompt, 'agent');

    expect(insertToAgentInput).toHaveBeenCalledWith('review this diff');
    expect(hoisted.toast).not.toHaveBeenCalled();
  });

  it('既无终端也无 agent 输入：clipboard 兜底并提示', async () => {
    const { result } = renderHook(() => useInsertPromptToWorkspace());

    result.current(prompt, 'terminal');

    await vi.waitFor(() =>
      expect(hoisted.toast).toHaveBeenCalledWith('Prompt copied to clipboard', 'info'),
    );
    expect(hoisted.clipboard).toHaveBeenCalledWith('review this diff', 'prompt');
  });

  it('clipboard 也失败：不再补「已复制」提示（不误报成功）', async () => {
    hoisted.clipboard.mockImplementationOnce(async () => false);
    const { result } = renderHook(() => useInsertPromptToWorkspace());

    result.current(prompt);
    await new Promise((r) => setTimeout(r, 0));

    expect(hoisted.toast).not.toHaveBeenCalledWith('Prompt copied to clipboard', 'info');
  });

  it('默认目标是 agent（调用方省略 target 时不静默走终端）', () => {
    const insertToTerminal = vi.fn(() => true);
    const insertToAgentInput = vi.fn();
    hoisted.api.current = { insertToTerminal, insertToAgentInput };
    const { result } = renderHook(() => useInsertPromptToWorkspace());

    result.current(prompt);

    expect(insertToTerminal).not.toHaveBeenCalled();
    expect(insertToAgentInput).toHaveBeenCalledWith('review this diff');
  });
});
