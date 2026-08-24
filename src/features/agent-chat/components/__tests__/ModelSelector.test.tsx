import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { AgentConfig } from '@/shared/types/agent';

import { ModelSelector } from '../ModelSelector';

function makeAgent(overrides: Partial<AgentConfig> = {}): AgentConfig {
  return {
    id: 'agent-a',
    name: 'Agent A',
    command: 'cmd',
    args: [],
    env: {},
    icon: null,
    enabled: true,
    ...overrides,
  };
}

function makeSelected(icon: string | null, name = 'Agent A', id = 'agent-a') {
  return {
    id,
    name,
    tag: name.slice(0, 2).toUpperCase(),
    color: 'hsl(120 60% 55%)',
    icon,
  };
}

describe('ModelSelector 复用 agent CLI 图标', () => {
  it('按钮显示所选 agent 的真实 CLI 图标而非通用 Brain 图标', () => {
    render(
      <ModelSelector
        chatAgents={[makeAgent({ id: 'a1', name: 'Claude Code', icon: 'claude-code.png' })]}
        selectedAgent={makeSelected('claude-code.png', 'Claude Code', 'a1')}
        tabKey="t"
        tabId="tab"
      />,
    );

    const btn = screen.getByRole('button', { name: /Claude Code/ });
    const img = within(btn).getByRole('img', { name: 'Claude Code' });
    expect(img).toHaveAttribute('src', expect.stringContaining('claude-code.png'));
    // eslint-disable-next-line testing-library/no-node-access -- 负向断言：确认通用 Brain 图标已被 CLI 真实图标替换
    expect(btn.querySelector('svg.lucide-brain')).toBeNull();
  });

  it('下拉列表逐项渲染每个 agent 的真实图标', () => {
    render(
      <ModelSelector
        chatAgents={[
          makeAgent({ id: 'a1', name: 'Claude Code', icon: 'claude-code.png' }),
          makeAgent({ id: 'a2', name: 'Gemini', icon: 'gemini.png' }),
        ]}
        selectedAgent={makeSelected('claude-code.png', 'Claude Code', 'a1')}
        tabKey="t"
        tabId="tab"
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /Claude Code/ }));

    // 主按钮 + 两个下拉项均渲染各自 agent 的真实图标
    const imgs = screen.getAllByRole('img');
    expect(imgs).toHaveLength(3);
    expect(imgs[0]).toHaveAttribute('src', expect.stringContaining('claude-code.png'));
    expect(imgs[1]).toHaveAttribute('src', expect.stringContaining('claude-code.png'));
    expect(imgs[2]).toHaveAttribute('src', expect.stringContaining('gemini'));
    expect(screen.getByRole('img', { name: 'Gemini' })).toBeInTheDocument();
  });

  it('icon 为 null 的 agent 在按钮上降级为 lucide Asterisk 图标兜底', () => {
    render(
      <ModelSelector
        chatAgents={[makeAgent({ id: 'custom-x', name: 'CustomX', icon: null })]}
        selectedAgent={makeSelected(null, 'CustomX', 'custom-x')}
        tabKey="t"
        tabId="tab"
      />,
    );

    const btn = screen.getByRole('button', { name: /CustomX/ });
    expect(within(btn).queryByRole('img')).not.toBeInTheDocument();
    // eslint-disable-next-line testing-library/no-node-access -- 验证无图标 agent 降级为 Rotate3d
    expect(btn.querySelector('svg.lucide-rotate-3d')).not.toBeNull();
  });

  it('icon 为 null 的 agent 在下拉项中降级为 lucide Rotate3d 图标兜底', () => {
    const { container } = render(
      <ModelSelector
        chatAgents={[makeAgent({ id: 'custom-x', name: 'CustomX', icon: null })]}
        selectedAgent={makeSelected(null, 'CustomX', 'custom-x')}
        tabKey="t"
        tabId="tab"
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /CustomX/ }));

    // 主按钮与下拉项都渲染 Rotate3d 图标，且无任何 img
    // eslint-disable-next-line testing-library/no-container, testing-library/no-node-access -- 验证无图标 agent 降级为 Rotate3d
    expect(container.querySelectorAll('svg.lucide-rotate-3d')).toHaveLength(2);
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });
});
