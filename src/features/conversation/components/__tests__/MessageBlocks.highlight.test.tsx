/* eslint-disable testing-library/no-container, testing-library/no-node-access -- 断言 <mark> 结构，testing-library 查询 API 不适用 */
import { render, screen } from '@testing-library/react';
import React from 'react';
import { describe, expect, it } from 'vitest';

import { MessageBlockList, TextBlock } from '../MessageBlocks';

describe('MessageBlocks search highlight', () => {
  it('TextBlock renders <mark> for matching query', () => {
    const { container } = render(<TextBlock text="Auth refactor done" highlightQuery="auth" />);
    const marks = container.querySelectorAll('mark');
    expect(marks.length).toBeGreaterThan(0);
    expect(marks[0]).toHaveTextContent('Auth');
  });

  it('TextBlock falls back to markdown when query absent', () => {
    const { container } = render(<TextBlock text="# Title" />);
    expect(container.querySelectorAll('mark')).toHaveLength(0);
    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
  });

  it('MessageBlockList passes highlightQuery to text blocks', () => {
    const { container } = render(
      <MessageBlockList
        blocks={[{ type: 'text', text: 'deploy the auth service' }]}
        highlightQuery="auth"
      />,
    );
    const marks = container.querySelectorAll('mark');
    expect(marks.length).toBeGreaterThan(0);
  });
});
