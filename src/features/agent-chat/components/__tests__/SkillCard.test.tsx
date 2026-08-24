import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import SkillCard from '../SkillCard';

describe('SkillCard', () => {
  const defaultProps = {
    name: 'codebase-design',
    filePath: '.grok/skills/codebase-design/SKILL.md',
    content: '# Codebase Design\n\nThis skill provides codebase design guidelines.',
  };

  it('renders skill name and file path', () => {
    render(<SkillCard {...defaultProps} />);
    expect(screen.getByTestId('skill-card')).toBeInTheDocument();
    expect(screen.getByText('codebase-design')).toBeInTheDocument();
    expect(screen.getByText('.grok/skills/codebase-design/SKILL.md')).toBeInTheDocument();
  });

  it('renders with loaded status by default', () => {
    render(<SkillCard {...defaultProps} />);
    expect(screen.getByText('loaded')).toBeInTheDocument();
  });

  it('does not show content by default (collapsed)', () => {
    render(<SkillCard {...defaultProps} />);
    expect(
      screen.queryByText('This skill provides codebase design guidelines.'),
    ).not.toBeInTheDocument();
  });

  it('expands to show content when header is clicked', () => {
    render(<SkillCard {...defaultProps} />);
    fireEvent.click(screen.getByTestId('skill-card-header'));
    expect(screen.getByTestId('skill-body')).toBeInTheDocument();
    expect(screen.getByTestId('skill-body')).toHaveTextContent(
      'This skill provides codebase design guidelines.',
    );
  });

  it('collapses when header is clicked again', () => {
    render(<SkillCard {...defaultProps} />);
    const header = screen.getByTestId('skill-card-header');
    fireEvent.click(header);
    expect(screen.getByTestId('skill-body')).toBeInTheDocument();
    fireEvent.click(header);
    expect(screen.queryByTestId('skill-body')).not.toBeInTheDocument();
  });

  it('shows running status with correct class', () => {
    render(<SkillCard {...defaultProps} status="running" />);
    expect(screen.getByTestId('skill-card')).toHaveClass('running');
    expect(screen.getByText('running')).toBeInTheDocument();
  });

  it('shows done status with correct class', () => {
    render(<SkillCard {...defaultProps} status="done" />);
    expect(screen.getByTestId('skill-card')).toHaveClass('done');
    expect(screen.getByText('done')).toBeInTheDocument();
  });
});
