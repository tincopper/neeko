import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { DEFAULT_AGENT_ICON } from '@/shared/utils/agents';

import { resolveAgentIconSrc } from '../../api/agentApi';
import AgentIcon from '../AgentIcon';

describe('AgentIcon', () => {
  it('preset 图标 → img src 为解析后的 URL', () => {
    render(<AgentIcon icon={DEFAULT_AGENT_ICON} alt="icon" />);
    expect(screen.getByRole('img')).toHaveAttribute('src', resolveAgentIconSrc(DEFAULT_AGENT_ICON));
  });

  it('自定义路径 → 走 convertFileSrc 分支', () => {
    const custom = '/tmp/agent-icons/abc.png';
    render(<AgentIcon icon={custom} alt="icon" />);
    const src = screen.getByRole('img').getAttribute('src');
    expect(src).toBe(resolveAgentIconSrc(custom));
    expect(src).toContain(custom);
  });

  it('icon 为 null → 渲染 fallback', () => {
    render(<AgentIcon icon={null} fallback={<span>FB</span>} />);
    expect(screen.getByText('FB')).toBeInTheDocument();
  });

  it('fallback 为字符串 → 包一层 span', () => {
    render(<AgentIcon icon={null} fallback="?" />);
    expect(screen.getByText('?').tagName).toBe('SPAN');
  });

  it('字符串兜底按字面渲染，不做 HTML 实体解码', () => {
    // 陷阱记录（2026-11-08）：实体写在 JSX 属性里会被解码，写在函数实参里不会。
    // 本组件拿到的是**已解码**的字符串，不要再假设它会解码 —— 否则 `&#9889;`
    // 会以字面文本出现在界面上（trellis-check 实测）。
    render(<AgentIcon icon={null} fallback={'&#9889;'} />);
    expect(screen.getByText('&#9889;')).toBeInTheDocument();
  });
});
