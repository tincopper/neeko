import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { createAppProviderWrapper } from '@/testing/AppProviderTestUtils';

import type { MessageBlock } from '../../types';
import { MessageBlockList } from '../MessageBlocks';

const toolUse = (id: string, name = 'Bash'): MessageBlock => ({
  type: 'toolUse',
  id,
  name,
  input: { command: 'ls' },
});

const toolResult = (toolUseId: string, isError = false): MessageBlock => ({
  type: 'toolResult',
  toolUseId,
  content: isError ? 'boom' : 'ok',
  isError,
});

describe('MessageBlockList 配对渲染', () => {
  it('renders a single combined group when toolUse + toolResult match', async () => {
    const user = userEvent.setup();
    render(<MessageBlockList blocks={[toolUse('t1'), toolResult('t1')]} />, {
      wrapper: createAppProviderWrapper(),
    });
    expect(screen.getByText('Bash')).toBeInTheDocument();
    // 只有一个工具组，无独立重复的 Bash 标签
    expect(screen.getAllByText('Bash')).toHaveLength(1);
    await user.click(screen.getByText('Bash'));
    expect(screen.getByText('Result')).toBeInTheDocument();
  });

  it('does not render the result section when toolUse has no matching result', async () => {
    const user = userEvent.setup();
    render(<MessageBlockList blocks={[toolUse('t1')]} />, { wrapper: createAppProviderWrapper() });
    await user.click(screen.getByText('Bash'));
    expect(screen.getByText('Bash')).toBeInTheDocument();
    expect(screen.queryByText('Result')).not.toBeInTheDocument();
  });

  it('collapses a success result by default and expands on click', async () => {
    const user = userEvent.setup();
    render(<MessageBlockList blocks={[toolUse('t1'), toolResult('t1')]} />, {
      wrapper: createAppProviderWrapper(),
    });
    await user.click(screen.getByText('Bash'));
    expect(screen.queryByText('ok')).not.toBeInTheDocument();
    await user.click(screen.getByText('Result'));
    expect(screen.getByText('ok')).toBeInTheDocument();
  });

  it('expands an error result by default', async () => {
    const user = userEvent.setup();
    render(<MessageBlockList blocks={[toolUse('t1'), toolResult('t1', true)]} />, {
      wrapper: createAppProviderWrapper(),
    });
    await user.click(screen.getByText('Bash'));
    expect(screen.getByText('boom')).toBeInTheDocument();
    expect(screen.getByText('Error')).toBeInTheDocument();
  });
});
