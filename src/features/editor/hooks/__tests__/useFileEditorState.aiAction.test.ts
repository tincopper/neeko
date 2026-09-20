/**
 * useFileEditorState 的 AI 动作登记（M3）：挂载时把"诊断上下文 → buildCodeMessage →
 * 派发"注册进 aiActionRegistry，诊断 UI（Problems 面板 / 编辑器 hover popup）由此
 * 跨面板触达（B1：agent 自己改文件，宿主只传上下文）。
 */
import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  runAiActionForUri,
  unregisterAiActionHandler,
} from '@/features/editor/api/aiActionRegistry';
import { useProjectStore } from '@/shared/store/projectStore';
import type { FileTab } from '@/shared/types';
import { tabIdentityOf, fileRefFromLspUri } from '@/shared/utils/fileRef';

import { useFileEditorState } from '../useFileEditorState';

const editorStateMock = vi.hoisted(() => ({
  tabs: {} as Record<string, { tabs: unknown[] }>,
  addTab: vi.fn(),
  activateTab: vi.fn(),
}));
vi.mock('@/shared/store/editorStore', () => ({
  useEditorStore: { getState: () => editorStateMock },
}));

const getAgent = vi.hoisted(() => vi.fn());
vi.mock('@/features/agent/api/agentApi', () => ({ getAgent }));

const createTaskTerminal = vi.hoisted(() => vi.fn(() => true));
vi.mock('@/features/terminal/api/taskTerminal', () => ({ createTaskTerminal }));

const sendToAgent = vi.fn(() => true);
const clearPending = vi.fn();
vi.mock('@/shared/hooks/useEditorAgentActions', () => ({
  useEditorAgentActions: () => ({ sendToAgent, pending: null, clearPending }),
}));

vi.mock('@/shared/utils/codemirror', () => ({
  getCachedLanguageExtension: () => null,
  getLanguageExtension: () => Promise.resolve(null),
  isMarkdownFile: () => false,
}));

const TAB: FileTab = {
  id: 'p1:/proj/main.go',
  projectId: 'p1',
  filePath: '/proj/main.go',
  fileName: 'main.go',
  content: { path: '/proj/main.go', content: 'package main\n', size: 13, is_binary: false },
  isDirty: false,
  order: 0,
};

const URI = 'file:///proj/main.go';
const IDENTITY = tabIdentityOf(fileRefFromLspUri(URI)!);

describe('useFileEditorState · AI 动作登记（aiActionRegistry）', () => {
  beforeEach(() => {
    sendToAgent.mockClear();
    sendToAgent.mockReturnValue(true);
    clearPending.mockClear();
    useProjectStore.setState({ projects: [{ id: 'p1', path: '/proj' }] });
  });

  afterEach(() => {
    unregisterAiActionHandler(IDENTITY);
  });

  it('挂载即登记：LSP uri 解析到本编辑器页并派发（1-based 行 + 诊断消息）', () => {
    renderHook(() => useFileEditorState({ tab: TAB, projectPath: '/proj' }));

    const sent = runAiActionForUri(URI, {
      action: 'fix',
      startLine: 4,
      endLine: 4,
      diagnosticMessage: 'undefined: fmt',
    });

    expect(sent).toBe(true);
    expect(sendToAgent).toHaveBeenCalledWith(
      'p1',
      'fix the following problem in this go code at main.go:4-4: undefined: fmt',
    );
  });

  it('explain 同路（诊断上下文完整传达）', () => {
    renderHook(() => useFileEditorState({ tab: TAB, projectPath: '/proj' }));

    runAiActionForUri(URI, {
      action: 'explain',
      startLine: 2,
      endLine: 5,
      diagnosticMessage: 'mismatched types',
    });

    expect(sendToAgent).toHaveBeenCalledWith(
      'p1',
      'explain the following problem in this go code at main.go:2-5: mismatched types',
    );
  });

  it('没有 agent 终端时经 terminal 端口创建 taskCommand 终端（F2：editor 不手造 Tab）', async () => {
    sendToAgent.mockReturnValue(false);
    createTaskTerminal.mockClear();
    vi.mocked(getAgent).mockResolvedValue({
      id: 'opencode',
      name: 'OpenCode',
      command: 'opencode',
      args: [],
      env: {},
      prompt_args: ['run', '--pure', '--dangerously-skip-permissions=true', '-f'],
      interactive_prompt_args: ['--prompt'],
      post_prompt_args: null,
    });
    renderHook(() => useFileEditorState({ tab: TAB, projectPath: '/proj' }));

    const sent = runAiActionForUri(URI, {
      action: 'fix',
      startLine: 1,
      endLine: 1,
      diagnosticMessage: 'm',
    });

    expect(sent).toBe(true);
    expect(clearPending).toHaveBeenCalled();
    // terminal 端口唯一入口：taskCommand 与 buildAgentPromptCommand 输出一致
    //（PTY 直接执行 taskCommand，打开 opencode CLI 并预填 prompt，交互 TUI 形态）
    await waitFor(() => expect(createTaskTerminal).toHaveBeenCalledTimes(1));
    expect(createTaskTerminal).toHaveBeenCalledWith('p1', {
      agentId: 'opencode',
      agentName: 'OpenCode',
      taskCommand:
        "opencode --prompt 'fix the following problem in this go code at main.go:1-1: m'",
    });
    // editor 侧不再直写 editorStore（配额/ID 收敛 terminal 域）
    expect(editorStateMock.addTab).not.toHaveBeenCalled();
  });

  it('卸载即注销：不再派发', () => {
    const { unmount } = renderHook(() => useFileEditorState({ tab: TAB, projectPath: '/proj' }));
    unmount();

    expect(runAiActionForUri(URI, { action: 'fix', startLine: 1, endLine: 1 })).toBe(false);
    expect(sendToAgent).not.toHaveBeenCalled();
  });
});
