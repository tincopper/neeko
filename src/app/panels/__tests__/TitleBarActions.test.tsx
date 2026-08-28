import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/features/task', () => ({
  TaskRunButton: () => <button type="button">task-run-stub</button>,
}));
vi.mock('@/features/debug', () => ({
  DebugRunButton: () => <button type="button">debug-run-stub</button>,
}));
vi.mock('@/app/components/OpenIdeButton', () => ({
  default: () => <button type="button">open-ide-stub</button>,
}));

import TitleBarActions from '../TitleBarActions';

describe('TitleBarActions', () => {
  it('渲染全部 TitleBar 入口按钮（新增入口只改本文件）', () => {
    render(<TitleBarActions />);
    expect(screen.getByText('open-ide-stub')).toBeInTheDocument();
    expect(screen.getByText('task-run-stub')).toBeInTheDocument();
    expect(screen.getByText('debug-run-stub')).toBeInTheDocument();
  });
});
