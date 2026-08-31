import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import DiffView from '../DiffView';
import type { DiffResult } from '../types';

const mockGetFileDiff = vi.fn();

vi.mock('@/features/git/api/gitApi', () => ({
  getFileDiff: (...args: unknown[]) => mockGetFileDiff(...args),
}));

vi.mock('@/features/terminal/components/terminalCommands', () => ({
  sendToTerminal: vi.fn(),
}));

vi.mock('@/shared/hooks/useFileChangedEvent', () => ({
  useFileChangedEvent: () => {},
}));

vi.mock('@/shared/hooks/useGitRefresh', () => ({
  useGitRefresh: () => {},
}));

vi.mock('@/features/quick-open', () => ({
  openProjectFile: (...args: unknown[]) => mockOpenProjectFile(...args),
}));

const mockOpenProjectFile = vi.fn(() => Promise.resolve());

const DIFF_SOURCE = { type: 'local', projectId: 'p1' } as const;

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

describe('DiffView — Open File 按钮（跳转对应文件）', () => {
  beforeEach(() => {
    mockOpenProjectFile.mockClear();
    mockGetFileDiff.mockReset();
    mockGetFileDiff.mockResolvedValue(diffResult);
  });

  it('点击 Open File → openProjectFile 打开对应项目文件', async () => {
    render(<DiffView projectId="p1" diffSource={DIFF_SOURCE} filePath="src/a.ts" />);

    await waitFor(() => {
      expect(screen.getByTitle('Open File')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTitle('Open File'));

    expect(mockOpenProjectFile).toHaveBeenCalledWith({ projectId: 'p1', filePath: 'src/a.ts' });
  });
});
