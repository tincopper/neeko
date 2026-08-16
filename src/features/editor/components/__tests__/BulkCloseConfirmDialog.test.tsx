import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import BulkCloseConfirmDialog from '../BulkCloseConfirmDialog';

function renderDialog(overrides = {}) {
  render(
    <BulkCloseConfirmDialog
      open={true}
      dirtyCount={2}
      dirtyPreview="a.ts, b.ts"
      onConfirm={vi.fn()}
      onCancel={vi.fn()}
      {...overrides}
    />,
  );
}

describe('BulkCloseConfirmDialog', () => {
  it('renders dirty count and preview with confirm/cancel buttons', () => {
    renderDialog();

    expect(screen.getByText(/2 files/)).toBeInTheDocument();
    expect(screen.getByText(/a\.ts, b\.ts/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
  });

  it('calls onConfirm when Close is clicked', () => {
    const onConfirm = vi.fn();
    renderDialog({ onConfirm });
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('calls onCancel when Cancel is clicked', () => {
    const onCancel = vi.fn();
    renderDialog({ onCancel });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('does not render when closed', () => {
    renderDialog({ open: false });
    expect(screen.queryByRole('button', { name: 'Close' })).not.toBeInTheDocument();
  });
});
