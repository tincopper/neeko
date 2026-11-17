import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { useAgentStore } from '@/shared/store/agentStore';
import { getAgentIconSrc } from '@/shared/utils/agents';
import { createAgent } from '@/testing/factories';

import { AgentIcon } from '../AgentIcon';

/**
 * 成员头像里的 agent 图标 —— **与 tab 栏 / agent 列表同一份**。
 *
 * 用户报障：团队花名册里 pi、codebuddy 这类成员只显示一个字母，而 tab 栏上的同一批 agent
 * 都有自己的图标。原因不是「没有图标资源」，而是团队侧另建了一张手写的 Simple Icons 表
 * （只有 claude-code / codex 两项），其余一律回退首字母 —— 图标资源（`assets/agents/*`
 * 与 `AgentConfig.icon`）本来就已经存在，只是没有复用。
 *
 * 所以判据只有一条：**图标来自 agent 配置**（`useAgentStore` 里那个 agent 的 `icon` 字段，
 * 由 `features/agent` 的门面组件解析 preset / 上传路径）。团队侧不持有一张自己的品牌表。
 */
describe('AgentIcon — 图标来源是 agent 配置（与 tab 栏同源）', () => {
  beforeEach(() => {
    useAgentStore.setState({
      agents: [
        // 没有内置品牌 SVG 的 CLI（用户报障的那两个）
        createAgent({ id: 'pi', name: 'Pi', command: 'pi', icon: 'pi.svg' }),
        createAgent({
          id: 'codebuddy',
          name: 'CodeBuddy',
          command: 'codebuddy',
          icon: 'codebuddy.svg',
        }),
        // 有 PNG 图标的
        createAgent({
          id: 'claude-code',
          name: 'Claude Code',
          command: 'claude',
          icon: 'claude-code.png',
        }),
        // 显式没有图标（自定义 agent 允许 `icon: null`）
        createAgent({ id: 'custom-plain', name: 'Plain', command: 'plain', icon: null }),
      ],
      loading: false,
    });
  });

  it('pi / codebuddy：用配置里的 SVG 图标，不再退化成首字母', () => {
    // 断言比的是**那个 preset 解析出来的 URL**（同一个真相源 `getAgentIconSrc`）：
    // 小体积 svg 会被 Vite 内联成 data URI，所以不能断言文件名。
    const { rerender } = render(<AgentIcon agentId="pi" name="π 成员" label="pi" />);
    expect(screen.getByRole('img', { name: 'pi' })).toHaveAttribute(
      'src',
      getAgentIconSrc('pi.svg'),
    );

    rerender(<AgentIcon agentId="codebuddy" name="cb" label="codebuddy" />);
    expect(screen.getByRole('img', { name: 'codebuddy' })).toHaveAttribute(
      'src',
      getAgentIconSrc('codebuddy.svg'),
    );
  });

  it('PNG preset 同样走同一条解析（claude-code）', () => {
    render(<AgentIcon agentId="claude-code" name="Claude" label="claude-code" />);

    expect(screen.getByRole('img', { name: 'claude-code' })).toHaveAttribute(
      'src',
      getAgentIconSrc('claude-code.png'),
    );
  });

  it('agent 显式没有图标 ⇒ 首字母回退（不渲染一个空图）', () => {
    render(<AgentIcon agentId="custom-plain" name="plain" label="custom-plain" />);

    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    // 回退字形取**名字**首字母，不是 agentId
    expect(screen.getByText('P')).toBeInTheDocument();
  });

  it('agent 不在配置里（store 未加载 / 团队引用了已删掉的 agent）⇒ 首字母回退', () => {
    render(<AgentIcon agentId="ghost" name="ghost" label="ghost" />);

    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(screen.getByText('G')).toBeInTheDocument();
  });

  it('装饰场景（不传 label）不抢可访问名：图标对读屏是隐藏的', () => {
    render(<AgentIcon agentId="pi" name="pi" />);

    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(screen.getByAltText('')).toBeInTheDocument();
  });
});
