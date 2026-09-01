import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import AddProjectMenu from '../AddProjectMenu';

function renderMenu(
  overrides: Partial<
    Record<'onAddProject' | 'onCloneProject' | 'onAddWsl' | 'onAddRemote', () => void>
  > = {},
) {
  const view = {
    onAddProject: vi.fn(),
    onCloneProject: vi.fn(),
    onAddWsl: vi.fn(),
    onAddRemote: vi.fn(),
    ...overrides,
  };
  render(<AddProjectMenu onClose={vi.fn()} {...view} />);
  return view;
}

describe('AddProjectMenu', () => {
  it('renders the four add-project entries', () => {
    renderMenu();
    expect(screen.getByText('Add Local Project')).toBeInTheDocument();
    expect(screen.getByText('Clone from Git')).toBeInTheDocument();
    expect(screen.getByText('Add Remote Server')).toBeInTheDocument();
  });

  it('clicking "Clone from Git" fires onCloneProject', () => {
    const view = renderMenu();
    fireEvent.click(screen.getByText('Clone from Git'));
    expect(view.onCloneProject).toHaveBeenCalledTimes(1);
    expect(view.onAddProject).not.toHaveBeenCalled();
  });
});
