import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ISLAND_CLASS, Island } from '../Island';

describe('Island', () => {
  it('renders the shared shell classes with content', () => {
    render(<Island data-testid="island">content</Island>);
    const island = screen.getByTestId('island');
    expect(island).toHaveClass('rounded-lg', 'shadow-sm', 'bg-bg-secondary');
    expect(screen.getByText('content')).toBeInTheDocument();
  });

  it('merges caller sizing classes without dropping the shell', () => {
    render(
      <Island data-testid="island" className="flex-1">
        content
      </Island>,
    );
    const island = screen.getByTestId('island');
    expect(island).toHaveClass('flex-1', 'rounded-lg', 'bg-bg-secondary');
  });

  it('exposes the shell class string for non-div hosts like ResizablePanel', () => {
    for (const token of ['flex', 'flex-col', 'rounded-lg', 'shadow-sm', 'bg-bg-secondary']) {
      expect(ISLAND_CLASS.split(' ')).toContain(token);
    }
  });
});
