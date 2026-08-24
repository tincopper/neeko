import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { ToolCard } from '../types';
import WorkRows from '../WorkRows';

describe('WorkRows', () => {
  it('已完成工具组挂载时默认展开，编辑 diff 不会隐藏', () => {
    const tools: ToolCard[] = [
      {
        callId: 'edit-1',
        name: 'edit_file',
        title: 'src/a.ts',
        status: 'done',
        output: '+++ b/src/a.ts\n+export const a = 1;',
      },
      {
        callId: 'edit-2',
        name: 'write_file',
        title: 'src/b.ts',
        status: 'done',
        output: '+++ b/src/b.ts\n+export const b = 2;',
      },
    ];

    render(<WorkRows tools={tools} />);

    expect(screen.getByRole('button', { name: 'Edited 2 files' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    expect(screen.getAllByTestId('diff-card')).toHaveLength(2);
    expect(screen.getAllByTestId('diff-output')).toHaveLength(2);
    expect(screen.getByText('+export const a = 1;')).toBeInTheDocument();
  });
});
