import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import MessageBubble from '../MessageBubble';

const TS = new Date(2026, 6, 24, 9, 5, 0).getTime();

describe('MessageBubble 复制操作', () => {
  it('does not render a copy button when no copy handler is provided', () => {
    render(
      <MessageBubble kind="assistant" label="Assistant" timestamp={TS}>
        <p>body</p>
      </MessageBubble>,
    );
    expect(screen.queryByRole('button', { name: /copy/i })).not.toBeInTheDocument();
  });

  it('renders a copy button when onCopy is provided', () => {
    render(
      <MessageBubble kind="assistant" label="Assistant" timestamp={TS} onCopy={vi.fn()}>
        <p>body</p>
      </MessageBubble>,
    );
    expect(screen.getByRole('button', { name: /copy/i })).toBeInTheDocument();
  });

  it('invokes onCopy on click', async () => {
    const user = userEvent.setup();
    const onCopy = vi.fn();
    render(
      <MessageBubble kind="user" label="You" timestamp={TS} onCopy={onCopy}>
        <p>body</p>
      </MessageBubble>,
    );

    await user.click(screen.getByRole('button', { name: /copy/i }));
    expect(onCopy).toHaveBeenCalledTimes(1);
  });

  it('shows the copied state when copied is true', () => {
    render(
      <MessageBubble kind="assistant" label="Assistant" timestamp={TS} onCopy={vi.fn()} copied>
        <p>body</p>
      </MessageBubble>,
    );
    expect(screen.getByRole('button', { name: /copied/i })).toBeInTheDocument();
  });

  it('keeps the model tag rendering when copy button present', () => {
    render(
      <MessageBubble
        kind="assistant"
        label="Assistant"
        timestamp={TS}
        model="opus-4.8"
        onCopy={vi.fn()}
      >
        <p>body</p>
      </MessageBubble>,
    );
    expect(screen.getByText(/opus-4\.8/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /copy/i })).toBeInTheDocument();
  });
});
