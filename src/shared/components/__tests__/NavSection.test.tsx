import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import NavSection from '../nav/NavSection';

describe('NavSection', () => {
  it('starts collapsed by default and expands on header click', () => {
    render(
      <NavSection title="Agents">
        <div>row</div>
      </NavSection>,
    );
    expect(screen.queryByText('row')).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('Agents'));
    expect(screen.getByText('row')).toBeInTheDocument();
  });

  it('starts expanded when defaultExpanded', () => {
    render(
      <NavSection title="Tags" defaultExpanded>
        <div>row</div>
      </NavSection>,
    );
    expect(screen.getByText('row')).toBeInTheDocument();
  });

  it('renders header actions beside the title button', () => {
    render(
      <NavSection title="Tags" defaultExpanded actions={<button type="button">+</button>}>
        <div>row</div>
      </NavSection>,
    );
    expect(screen.getByRole('button', { name: '+' })).toBeInTheDocument();
  });
});
