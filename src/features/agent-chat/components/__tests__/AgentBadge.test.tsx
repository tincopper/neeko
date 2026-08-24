import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { resolveAgentIconSrc } from '@/features/agent/api/agentApi';

import { AgentBadge } from '../AgentBadge';

vi.mock('@/features/agent/api/agentApi', () => ({
  resolveAgentIconSrc: vi.fn(),
}));

const mockResolve = vi.mocked(resolveAgentIconSrc);

beforeEach(() => {
  mockResolve.mockReset();
});

describe('AgentBadge', () => {
  it('有 icon 时渲染真实 CLI 图标 <img>', () => {
    mockResolve.mockReturnValue('https://asset/claude-code.png');
    render(<AgentBadge icon="claude-code.png" name="Claude Code" id="a1" />);

    const img = screen.getByRole('img', { name: 'Claude Code' });
    expect(img).toHaveAttribute('src', 'https://asset/claude-code.png');
    expect(mockResolve).toHaveBeenCalledWith('claude-code.png');
  });

  it('icon 为 null 时降级为 lucide Rotate3d 图标', () => {
    mockResolve.mockReturnValue(null);
    const { container } = render(<AgentBadge icon={null} name="CustomX" id="custom-x" />);

    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    // eslint-disable-next-line testing-library/no-container, testing-library/no-node-access -- 验证无图标降级为 Rotate3d 图标
    expect(container.querySelector('svg.lucide-rotate-3d')).not.toBeNull();
  });

  it('resolve 返回空但 icon 非空时降级为 Rotate3d 图标', () => {
    mockResolve.mockReturnValue(null);
    const { container } = render(<AgentBadge icon="unknown.png" name="AgentX" id="ax" />);

    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    // eslint-disable-next-line testing-library/no-container, testing-library/no-node-access -- 验证无图标降级为 Rotate3d 图标
    expect(container.querySelector('svg.lucide-rotate-3d')).not.toBeNull();
  });

  it('img 加载失败（onError）时降级为 Rotate3d 图标', () => {
    mockResolve.mockReturnValue('https://asset/broken.png');
    const { container } = render(<AgentBadge icon="broken.png" name="AgentY" id="ay" />);

    const img = screen.getByRole('img', { name: 'AgentY' });
    fireEvent.error(img);

    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    // eslint-disable-next-line testing-library/no-container, testing-library/no-node-access -- 验证 onError 降级为 Rotate3d 图标
    expect(container.querySelector('svg.lucide-rotate-3d')).not.toBeNull();
  });
});
