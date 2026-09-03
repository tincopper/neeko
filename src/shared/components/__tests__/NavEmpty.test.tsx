import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import NavEmpty from '../nav/NavEmpty';

describe('NavEmpty', () => {
  it('renders the message with list empty styling', () => {
    render(<NavEmpty>No agents configured.</NavEmpty>);
    const line = screen.getByText('No agents configured.');
    expect(line.tagName).toBe('P');
    expect(line).toHaveClass('text-text-muted');
  });
});
