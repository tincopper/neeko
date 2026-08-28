import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/features/task', () => ({
  TaskConsolePanel: () => <div data-testid="task-console-panel" />,
}));
vi.mock('@/features/debug', () => ({
  DebugPanel: () => <div data-testid="debug-panel" />,
}));

import FixedPanelsHost from '../FixedPanelsHost';
import { fixedPanelRegistry } from '../registry';

describe('FixedPanelsHost', () => {
  it('按 registry 渲染全部固定面板（lazy 解析后）', async () => {
    render(<FixedPanelsHost />);
    // lazy 组件异步 resolve，用 findBy 等待首个面板挂载
    expect(await screen.findByTestId('task-console-panel')).toBeInTheDocument();
    expect(screen.getByTestId('debug-panel')).toBeInTheDocument();
  });

  it('registry 是固定面板唯一清单（新增面板只改 registry，组合根零改动）', () => {
    const ids = fixedPanelRegistry.map((p) => p.id);
    expect(ids).toEqual(['task-console', 'debug']);
  });

  it('每个 registry 项都携带可渲染的组件定义', () => {
    for (const entry of fixedPanelRegistry) {
      expect(entry.id).toBeTruthy();
      expect(entry.Component).toBeDefined();
    }
  });
});
