import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import CountLabel from '../nav/CountLabel';

describe('CountLabel', () => {
  it('renders the formatted count when loaded', () => {
    render(<CountLabel loading={false} count={7} format={(n) => `${n}g`} />);
    expect(screen.getByText('7g')).toBeInTheDocument();
  });

  it('renders zero while refreshing a known count', () => {
    render(<CountLabel loading count={3} />);
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('renders the loading glyph when no value yet', () => {
    render(<CountLabel loading />);
    expect(screen.getByText('…')).toBeInTheDocument();
  });

  it('renders the error glyph in red', () => {
    render(<CountLabel loading={false} error={new Error('x')} />);
    const glyph = screen.getByText('!');
    expect(glyph).toHaveClass('text-accent-red');
  });
});
