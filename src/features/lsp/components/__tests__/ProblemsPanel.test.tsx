import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { openProjectFile } from '@/features/quick-open';

import { useLspStore } from '../../store/lspStore';
import type { LspDiagnostic } from '../../types';
import ProblemsPanel from '../ProblemsPanel';

vi.mock('@/features/quick-open', () => ({
  openProjectFile: vi.fn(() => Promise.resolve()),
}));

// projectStore mock：面板取 activeProject 的 id（跳转）与 path（切片键）。
const projectState: { activeProject: { id: string; path: string } | null } = {
  activeProject: { id: 'p1', path: '/proj' },
};
vi.mock('@/shared/store/projectStore', () => ({
  useProjectStore: (selector: (s: typeof projectState) => unknown) => selector(projectState),
}));

function diag(line: number, character: number, message: string): LspDiagnostic {
  return {
    range: { start: { line, character }, end: { line, character: character + 4 } },
    severity: 1,
    message,
    source: 'gopls',
  };
}

describe('ProblemsPanel', () => {
  beforeEach(() => {
    vi.mocked(openProjectFile).mockClear();
    useLspStore.setState({ diagnosticsByProject: {}, problemsPanelOpen: false });
  });

  it('renders nothing while the panel is closed', () => {
    render(<ProblemsPanel />);
    expect(screen.queryByTestId('problems-panel')).not.toBeInTheDocument();
  });

  it('renders store diagnostics for the active project while open', () => {
    useLspStore.setState({
      problemsPanelOpen: true,
      diagnosticsByProject: {
        '/proj': { 'file:///proj/src/main.go': [diag(0, 0, 'undefined: Printf')] },
      },
    });

    render(<ProblemsPanel />);

    expect(screen.getByTestId('problems-panel')).toBeInTheDocument();
    // VS Code 组头：文件名主色 + 父目录暗色独立段（不再有整路径单文本节点）
    expect(screen.getByText('main.go')).toBeInTheDocument();
    expect(screen.getByText('src')).toBeInTheDocument();
    expect(screen.getByText('undefined: Printf')).toBeInTheDocument();
  });

  it('opens the diagnostic target via openProjectFile with 1-based line and column', () => {
    useLspStore.setState({
      problemsPanelOpen: true,
      diagnosticsByProject: {
        '/proj': { 'file:///proj/src/main.go': [diag(2, 4, 'boom')] },
      },
    });

    render(<ProblemsPanel />);
    fireEvent.click(screen.getByTestId('diagnostic-row'));

    // LSP line 2 (0-based) → 编辑器行 3（1-based）；character 4 原样透传
    expect(openProjectFile).toHaveBeenCalledWith({
      projectId: 'p1',
      filePath: '/proj/src/main.go',
      line: 3,
      column: 4,
    });
  });

  it('close button hides the panel via the store', () => {
    useLspStore.setState({ problemsPanelOpen: true, diagnosticsByProject: {} });

    render(<ProblemsPanel />);
    fireEvent.click(screen.getByTestId('problems-panel-close'));

    expect(useLspStore.getState().problemsPanelOpen).toBe(false);
    expect(screen.queryByTestId('problems-panel')).not.toBeInTheDocument();
  });
});
