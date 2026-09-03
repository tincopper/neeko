import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import NavRow from '../nav/NavRow';

describe('NavRow', () => {
  it('button mode: selects on click and reflects active state', () => {
    const onSelect = vi.fn();
    const { rerender } = render(
      <NavRow active={false} onSelect={onSelect}>
        <span>label</span>
      </NavRow>,
    );
    const row = screen.getByRole('button', { name: 'label' });
    expect(row).not.toHaveClass('bg-bg-selected');

    fireEvent.click(row);
    expect(onSelect).toHaveBeenCalledTimes(1);

    rerender(
      <NavRow active onSelect={onSelect}>
        <span>label</span>
      </NavRow>,
    );
    expect(screen.getByRole('button', { name: 'label' })).toHaveClass('bg-bg-selected');
  });

  it('actions mode: div role=button with hover-reveal actions, keyboard selects', () => {
    const onSelect = vi.fn();
    render(
      <NavRow active={false} onSelect={onSelect} actions={<button type="button">x</button>}>
        <span>label</span>
      </NavRow>,
    );
    const row = screen.getByRole('button', { name: 'label x' });
    expect(row.tagName).toBe('DIV');

    fireEvent.keyDown(row, { key: 'Enter' });
    fireEvent.keyDown(row, { key: ' ' });
    expect(onSelect).toHaveBeenCalledTimes(2);
  });
});
