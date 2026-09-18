import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useLspStore } from '@/features/lsp/store/lspStore';
import type { LspDiagnostic } from '@/features/lsp/types';

import { ProblemsItem } from '../items/ProblemsItem';

// projectStore mock：可变单 project 态（部分用例置 null 验证空渲染）。
const projectState: { activeProject: { id: string; path: string } | null } = {
  activeProject: { id: 'p1', path: '/proj' },
};
vi.mock('@/shared/store/projectStore', () => ({
  useProjectStore: (selector: (s: typeof projectState) => unknown) => selector(projectState),
}));

function diag(severity: number | null): LspDiagnostic {
  return {
    range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
    severity,
    message: 'm',
    source: null,
  };
}

describe('ProblemsItem', () => {
  beforeEach(() => {
    projectState.activeProject = { id: 'p1', path: '/proj' };
    useLspStore.setState({
      diagnosticsByProject: {},
      problemsPanelOpen: false,
    });
  });

  it('renders nothing without an active project', () => {
    projectState.activeProject = null;
    const { container } = render(<ProblemsItem />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows error and warning counts from the active project slice', () => {
    useLspStore.setState({
      diagnosticsByProject: {
        '/proj': {
          'file:///proj/a.go': [diag(1), diag(1), diag(2)],
          'file:///proj/b.go': [diag(2), diag(3)],
        },
      },
    });

    render(<ProblemsItem />);

    // 2 errors / 2 warnings；info/hint 不计入右簇徽标
    const item = screen.getByTestId('problems-item');
    expect(item).toHaveTextContent('2');
    expect(item).toHaveTextContent('2');
  });

  it('click toggles the problems panel open state in the store', () => {
    render(<ProblemsItem />);
    fireEvent.click(screen.getByTestId('problems-item'));
    expect(useLspStore.getState().problemsPanelOpen).toBe(true);
    fireEvent.click(screen.getByTestId('problems-item'));
    expect(useLspStore.getState().problemsPanelOpen).toBe(false);
  });
});
