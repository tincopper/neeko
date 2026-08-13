import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import ReviewInstructionPopover from '../ReviewInstructionPopover';

describe('ReviewInstructionPopover (dropdown panel)', () => {
  it('should_render_input_with_placeholder', () => {
    render(<ReviewInstructionPopover open onSubmit={() => {}} onClose={() => {}} />);
    expect(screen.getByRole('dialog', { name: 'AI review options' })).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Review change with AI…')).toBeInTheDocument();
  });

  it('should_submit_trimmed_instruction_when_provided', () => {
    const onSubmit = vi.fn();
    render(<ReviewInstructionPopover open onSubmit={onSubmit} onClose={() => {}} />);
    fireEvent.change(screen.getByPlaceholderText(/review change with ai/i), {
      target: { value: '  focus on tests  ' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Submit review' }));
    expect(onSubmit).toHaveBeenCalledWith('focus on tests');
  });

  it('should_submit_undefined_when_instruction_empty', () => {
    const onSubmit = vi.fn();
    render(<ReviewInstructionPopover open onSubmit={onSubmit} onClose={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Submit review' }));
    expect(onSubmit).toHaveBeenCalledWith(undefined);
  });

  it('should_close_on_escape', () => {
    const onClose = vi.fn();
    render(<ReviewInstructionPopover open onSubmit={() => {}} onClose={onClose} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('should_close_on_outside_click', () => {
    const onClose = vi.fn();
    render(<ReviewInstructionPopover open onSubmit={() => {}} onClose={onClose} />);
    fireEvent.mouseDown(document.body);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('should_render_nothing_when_closed', () => {
    render(<ReviewInstructionPopover open={false} onSubmit={() => {}} onClose={() => {}} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('should_render_quick_action_items', () => {
    render(<ReviewInstructionPopover open onSubmit={() => {}} onClose={() => {}} />);
    expect(screen.getByText('Explain the changes')).toBeInTheDocument();
    expect(screen.getByText('Find potential bugs')).toBeInTheDocument();
    expect(screen.getByText('Generate commit message')).toBeInTheDocument();
  });

  it('should_submit_with_quick_action_preset_when_clicked', () => {
    const onSubmit = vi.fn();
    render(<ReviewInstructionPopover open onSubmit={onSubmit} onClose={() => {}} />);
    fireEvent.click(screen.getByText('Explain the changes'));
    expect(onSubmit).toHaveBeenCalledWith('Explain the changes in detail.');
  });

  it('should_render_model_selector_at_bottom', () => {
    render(<ReviewInstructionPopover open onSubmit={() => {}} onClose={() => {}} />);
    expect(screen.getByText(/Model:/)).toBeInTheDocument();
    expect(screen.getByText('Auto')).toBeInTheDocument();
  });

  it('should_submit_on_enter_key', () => {
    const onSubmit = vi.fn();
    render(<ReviewInstructionPopover open onSubmit={onSubmit} onClose={() => {}} />);
    const input = screen.getByPlaceholderText(/review change with ai/i);
    fireEvent.change(input, { target: { value: 'check naming' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onSubmit).toHaveBeenCalledWith('check naming');
  });
});
