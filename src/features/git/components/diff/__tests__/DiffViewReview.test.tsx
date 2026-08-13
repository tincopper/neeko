import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useEditorStore } from '@/shared/store/editorStore';
import { useNotificationStore } from '@/shared/store/notificationStore';
import type { DiffSource } from '@/shared/types/git';

import DiffView from '../DiffView';
import type { DiffResult } from '../types';

// 捕获 sendToTerminal 调用（agent 终端写入）
const sendToTerminal = vi.hoisted(() => vi.fn());

vi.mock('@/features/terminal/components/terminalCommands', () => ({
  sendToTerminal,
}));

// useDiffData 在无 commands 时动态 import gitApi.getFileDiff
const getFileDiff = vi.hoisted(() => vi.fn());

vi.mock('@/features/git/api/gitApi', () => ({
  getFileDiff,
}));

// 避免真实订阅（file-changed / Git 刷新）
vi.mock('@/shared/hooks/useFileChangedEvent', () => ({
  useFileChangedEvent: () => {},
}));
vi.mock('@/shared/hooks/useGitRefresh', () => ({
  useGitRefresh: () => {},
}));

const DIFF_SOURCE: DiffSource = { type: 'local', projectId: 'p1' };

const diffResult: DiffResult = {
  hunks: [
    {
      old_start: 1,
      old_lines: 2,
      new_start: 1,
      new_lines: 2,
      lines: [{ Context: 'keep' }, { Removed: 'old' }, { Added: 'new' }],
    },
  ],
};

/** 注入一个 agent 终端 tab，使 sendToAgent 命中并写入终端。 */
function seedAgentTab() {
  useEditorStore.setState({
    tabs: {
      p1: {
        tabs: [
          {
            id: 'agent-tab',
            projectId: 'p1',
            title: 'opencode',
            order: 0,
            data: { kind: 'terminal', agentId: 'opencode', status: 'Idle' },
          },
        ],
        activeTabId: 'agent-tab',
      },
    },
  });
}

describe('DiffView AI review (sendToAgent path)', () => {
  beforeEach(() => {
    sendToTerminal.mockReset();
    getFileDiff.mockReset();
    getFileDiff.mockResolvedValue(diffResult);
    seedAgentTab();
  });

  it('should_send_full_review_with_custom_instruction_and_diff_text', async () => {
    render(<DiffView projectId="p1" diffSource={DIFF_SOURCE} filePath="src/a.ts" />);

    // 等 diff 渲染完成，工具栏 Review 按钮可用
    await waitFor(() => {
      expect(screen.getByLabelText('Review this change')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByLabelText('Review this change'));
    expect(screen.getByRole('dialog', { name: 'AI review options' })).toBeInTheDocument();

    // 横向输入条：直接输入指令后提交
    fireEvent.change(screen.getByPlaceholderText(/review change with ai/i), {
      target: { value: 'focus on edge cases' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Submit review' }));

    expect(sendToTerminal).toHaveBeenCalledTimes(1);
    const [projectId, message, tabId] = sendToTerminal.mock.calls[0];
    expect(projectId).toBe('p1');
    expect(tabId).toBe('agent-tab');
    expect(message).toContain('review the changes in src/a.ts');
    expect(message).toContain('Custom instruction (highest priority):\nfocus on edge cases');
    expect(message).toContain('Diff:\n@@ -1,2 +1,2 @@');
    expect(message).toContain('1| keep');
    expect(message).toContain('2| new');
  });

  it('should_send_selection_review_without_instruction_when_empty', async () => {
    render(<DiffView projectId="p1" diffSource={DIFF_SOURCE} filePath="src/a.ts" />);

    await waitFor(() => {
      expect(screen.getByLabelText('Review this change')).toBeInTheDocument();
    });

    // 选中一行（Added 行），直接出现 inline 输入条（VSCode 风格）
    // 3 行 × 3 个可点击单元（old 行号、new 行号、内容），共 9 个
    // Added 行是第 3 行，点击其内容单元格（index 8）
    const lineCells = screen.getAllByTitle('Select line for AI review');
    fireEvent.mouseDown(lineCells[8], { button: 0 });
    fireEvent.click(lineCells[8]);

    // inline 输入条直接出现，placeholder 提示选区 review
    const input = await screen.findByPlaceholderText(/review .* selected line/i);
    expect(input).toBeInTheDocument();

    // 不输入指令，直接提交（点提交按钮）
    fireEvent.click(screen.getByRole('button', { name: 'Submit review' }));

    expect(sendToTerminal).toHaveBeenCalledTimes(1);
    const [projectId, message, tabId] = sendToTerminal.mock.calls[0];
    expect(projectId).toBe('p1');
    expect(tabId).toBe('agent-tab');
    expect(message).toContain('review the selected changes in src/a.ts');
    expect(message).not.toContain('Custom instruction');
    // 选区模式只发选中行（Added 行 new-side 行号为 2），不带 hunk header 与未选中行
    expect(message).toContain('Diff:\n-|2| new');
    expect(message).not.toContain('@@');
    expect(message).not.toContain('keep');
    expect(message).not.toContain('old');
  });

  it('should_show_warning_when_no_agent_terminal_open', async () => {
    // 清空 tabs，模拟没有 agent 终端
    useEditorStore.setState({ tabs: {} });

    render(<DiffView projectId="p1" diffSource={DIFF_SOURCE} filePath="src/a.ts" />);

    await waitFor(() => {
      expect(screen.getByLabelText('Review this change')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByLabelText('Review this change'));
    fireEvent.click(screen.getByRole('button', { name: 'Submit review' }));

    expect(sendToTerminal).not.toHaveBeenCalled();
    await waitFor(() => {
      const notifications = useNotificationStore.getState().notifications;
      expect(notifications.some((n) => n.title === 'No agent terminal open')).toBe(true);
    });
  });
});
