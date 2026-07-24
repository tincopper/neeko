import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import ProjectAvatar from '@/shared/components/ProjectAvatar';

describe('ProjectAvatar', () => {
  it('renders project initials when a name is provided', () => {
    render(<ProjectAvatar name="neeko" color="#61afef" size={16} />);
    expect(screen.getByText('N')).toBeInTheDocument();
  });

  it('renders multi-segment initials for hyphenated names', () => {
    render(<ProjectAvatar name="my-app" size={16} />);
    expect(screen.getByText('MA')).toBeInTheDocument();
  });

  it('falls back to the neeko icon when name is missing', () => {
    render(<ProjectAvatar name={null} size={16} />);
    const img = screen.getByAltText('Neeko');
    expect(img).toBeInTheDocument();
    expect(img.getAttribute('src')).toBeTruthy();
  });

  it('falls back to the neeko icon when name is empty', () => {
    render(<ProjectAvatar name="" size={16} />);
    expect(screen.getByAltText('Neeko')).toBeInTheDocument();
  });

  it('applies the provided color as the text color', () => {
    const { container } = render(
      <ProjectAvatar name="neeko" color="#e06c75" size={16} />,
    );
    const el = container.firstElementChild as HTMLElement;
    expect(el.style.color).toBe('rgb(224, 108, 117)');
  });
});
