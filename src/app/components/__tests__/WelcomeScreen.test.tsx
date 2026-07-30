import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { WelcomeScreen } from '../WelcomeScreen';

describe('WelcomeScreen', () => {
  it('should_render_value_propositions', () => {
    render(<WelcomeScreen onAddProject={vi.fn()} />);
    expect(screen.getByText('Multi-Agent Sessions')).toBeInTheDocument();
    expect(screen.getByText('Integrated Terminal')).toBeInTheDocument();
    expect(screen.getByText('Skill Library')).toBeInTheDocument();
  });

  it('should_render_primary_cta', () => {
    render(<WelcomeScreen onAddProject={vi.fn()} />);
    expect(screen.getByText('Add Your First Project')).toBeInTheDocument();
  });

  it('should_call_onAddProject_when_clicking_cta', () => {
    const onAddProject = vi.fn();
    render(<WelcomeScreen onAddProject={onAddProject} />);
    fireEvent.click(screen.getByText('Add Your First Project'));
    expect(onAddProject).toHaveBeenCalledOnce();
  });
});
