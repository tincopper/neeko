import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import MessageBubble from '@/features/conversation/components/MessageBubble';

describe('MessageBubble', () => {
  const TS = new Date(2026, 6, 24, 9, 5, 0).getTime();

  it('uses the blue accent strip and wash for user messages', () => {
    render(
      <MessageBubble kind="user" label="You" timestamp={TS}>
        <p>hello</p>
      </MessageBubble>,
    );
    const strip = screen.getByTestId('message-strip');
    expect(strip.className).toMatch(/border-l-accent-blue/);
    expect(strip.className).toMatch(/bg-accent-blue/);
    expect(screen.getByText('You')).toHaveClass('text-accent-blue');
  });

  it('uses the green accent strip for assistant messages', () => {
    render(
      <MessageBubble kind="assistant" label="Claude Code" timestamp={TS}>
        <p>hi</p>
      </MessageBubble>,
    );
    const strip = screen.getByTestId('message-strip');
    expect(strip.className).toMatch(/border-l-accent-green/);
    expect(screen.getByText('Claude Code')).toHaveClass('text-accent-green');
  });

  it('renders the model tag when provided', () => {
    render(
      <MessageBubble kind="assistant" label="Assistant" timestamp={TS} model="opus-4.8">
        <p>body</p>
      </MessageBubble>,
    );
    expect(screen.getByText(/opus-4\.8/)).toBeInTheDocument();
  });

  it('renders children as the body', () => {
    render(
      <MessageBubble kind="user" label="You" timestamp={TS}>
        <span>body content</span>
      </MessageBubble>,
    );
    expect(screen.getByText('body content')).toBeInTheDocument();
  });
});
