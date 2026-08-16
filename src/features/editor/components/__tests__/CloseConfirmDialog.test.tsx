import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import CloseConfirmDialog from '../CloseConfirmDialog';

function renderDialog(overrides = {}) {
  render(
    <CloseConfirmDialog
      open={true}
      fileName="src/index.ts"
      onSave={vi.fn()}
      onDiscard={vi.fn()}
      onCancel={vi.fn()}
      {...overrides}
    />,
  );
}

describe('CloseConfirmDialog', () => {
  it('renders the file name and three action buttons', () => {
    renderDialog();

    expect(screen.getByText(/src\/index\.ts/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: "Don't Save" })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
  });

  it('calls onSave when Save is clicked', () => {
    const onSave = vi.fn();
    renderDialog({ onSave });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it("calls onDiscard when Don't Save is clicked", () => {
    const onDiscard = vi.fn();
    renderDialog({ onDiscard });
    fireEvent.click(screen.getByRole('button', { name: "Don't Save" }));
    expect(onDiscard).toHaveBeenCalledTimes(1);
  });

  it('calls onCancel when Cancel is clicked', () => {
    const onCancel = vi.fn();
    renderDialog({ onCancel });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('does not render when closed', () => {
    renderDialog({ open: false });
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();
  });
});
