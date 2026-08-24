import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { ModelInfo } from '@/features/agent/api/agentApi';

import { ModelPicker } from '../ModelPicker';

function makeModel(overrides: Partial<ModelInfo> = {}): ModelInfo {
  return {
    id: 'model-1',
    name: 'Sonnet',
    supported_reasoning_efforts: ['low', 'high'],
    is_free: false,
    ...overrides,
  };
}

function makeAgent(icon: string | null, name = 'Claude Code') {
  return { id: 'a1', name, icon };
}

describe('ModelPicker 复用所选 agent 的 CLI 图标', () => {
  it('按钮显示所选 agent 的真实 CLI 图标而非通用 Brain 图标', () => {
    render(
      <ModelPicker
        models={[makeModel()]}
        selected={makeModel()}
        onChange={() => {}}
        agent={makeAgent('claude-code.png')}
      />,
    );

    const btn = screen.getByRole('button', { name: /Sonnet/ });
    const img = within(btn).getByRole('img', { name: 'Claude Code' });
    expect(img).toHaveAttribute('src', expect.stringContaining('claude-code.png'));
    // eslint-disable-next-line testing-library/no-node-access -- 负向断言：确认通用 Brain 图标已被 CLI 真实图标替换
    expect(btn.querySelector('svg.lucide-brain')).toBeNull();
  });

  it('模型列表项统一显示所选 agent 的 CLI 图标', () => {
    render(
      <ModelPicker
        models={[makeModel(), makeModel({ id: 'm2', name: 'Haiku' })]}
        selected={makeModel()}
        onChange={() => {}}
        agent={makeAgent('claude-code.png')}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /Sonnet/ }));

    // 主按钮 + 两个模型列表项均渲染 agent CLI 图标
    const imgs = screen.getAllByRole('img', { name: 'Claude Code' });
    expect(imgs).toHaveLength(3);
    imgs.forEach((img) => {
      expect(img).toHaveAttribute('src', expect.stringContaining('claude-code.png'));
    });
  });

  it('agent 无 icon 时按钮降级为 lucide Rotate3d 图标兜底', () => {
    render(
      <ModelPicker
        models={[makeModel()]}
        selected={makeModel()}
        onChange={() => {}}
        agent={makeAgent(null, 'CustomX')}
      />,
    );

    const btn = screen.getByRole('button', { name: /Sonnet/ });
    expect(within(btn).queryByRole('img')).not.toBeInTheDocument();
    // eslint-disable-next-line testing-library/no-node-access -- 验证无图标 agent 降级为 Rotate3d
    expect(btn.querySelector('svg.lucide-rotate-3d')).not.toBeNull();
  });
});
