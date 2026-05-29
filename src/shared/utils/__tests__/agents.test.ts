import { describe, it, expect } from 'vitest';
import { getAgentIconSrc } from '../../utils/agents';

describe('getAgentIconSrc', () => {
  it('null 输入返回 null', () => {
    expect(getAgentIconSrc(null)).toBeNull();
  });

  it('undefined 输入返回 null', () => {
    expect(getAgentIconSrc(undefined)).toBeNull();
  });

  it('空字符串返回 null', () => {
    expect(getAgentIconSrc('')).toBeNull();
  });

  it('未知图标返回 null', () => {
    expect(getAgentIconSrc('nonexistent-icon.svg')).toBeNull();
  });
});
