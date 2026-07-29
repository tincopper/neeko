import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { createTagGroup } from '../../../../testing/factories';
import TagGroupChipPicker from '../TagGroupChipPicker';

describe('TagGroupChipPicker', () => {
  const groups = [
    createTagGroup({ id: 'tg-1', name: 'Frontend', skill_count: 12, sort_order: 1 }),
    createTagGroup({ id: 'tg-2', name: 'Rust', skill_count: 8, sort_order: 0 }),
  ];

  it('renders chips sorted by sort_order then name', () => {
    render(
      <TagGroupChipPicker
        tagGroups={groups}
        selectedIds={[]}
        onChange={vi.fn()}
        onApply={vi.fn()}
      />,
    );
    const chips = screen.getAllByRole('option');
    expect(chips[0]).toHaveTextContent('Rust');
    expect(chips[1]).toHaveTextContent('Frontend');
  });

  it('toggles selection via onChange', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <TagGroupChipPicker
        tagGroups={groups}
        selectedIds={['tg-2']}
        onChange={onChange}
        onApply={vi.fn()}
      />,
    );

    await user.click(screen.getByTestId('tag-group-chip-tg-1'));
    expect(onChange).toHaveBeenCalledWith(['tg-2', 'tg-1']);

    await user.click(screen.getByTestId('tag-group-chip-tg-2'));
    expect(onChange).toHaveBeenCalledWith([]);
  });

  it('disables Apply when selection matches bound ids', () => {
    render(
      <TagGroupChipPicker
        tagGroups={groups}
        selectedIds={['tg-1']}
        boundIds={['tg-1']}
        onChange={vi.fn()}
        onApply={vi.fn()}
      />,
    );
    expect(screen.getByTestId('tag-group-apply')).toBeDisabled();
  });

  it('enables Apply when dirty and calls onApply', async () => {
    const user = userEvent.setup();
    const onApply = vi.fn();
    render(
      <TagGroupChipPicker
        tagGroups={groups}
        selectedIds={['tg-1', 'tg-2']}
        boundIds={['tg-1']}
        onChange={vi.fn()}
        onApply={onApply}
      />,
    );
    const apply = screen.getByTestId('tag-group-apply');
    expect(apply).toBeEnabled();
    await user.click(apply);
    expect(onApply).toHaveBeenCalledTimes(1);
  });

  it('shows empty state with open skills CTA', async () => {
    const user = userEvent.setup();
    const onView = vi.fn();
    render(
      <TagGroupChipPicker
        tagGroups={[]}
        selectedIds={[]}
        onChange={vi.fn()}
        onApply={vi.fn()}
        onViewInSkills={onView}
      />,
    );
    expect(screen.getByTestId('tag-group-chip-picker-empty')).toBeInTheDocument();
    await user.click(screen.getByText(/Open Skills to create/i));
    expect(onView).toHaveBeenCalled();
  });

  it('shows skill estimate for selected groups', () => {
    render(
      <TagGroupChipPicker
        tagGroups={groups}
        selectedIds={['tg-1', 'tg-2']}
        onChange={vi.fn()}
        onApply={vi.fn()}
      />,
    );
    expect(screen.getByText(/Selected 2 groups · ~20 skills/i)).toBeInTheDocument();
  });
});
