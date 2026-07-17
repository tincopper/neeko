import { describe, it, expect, vi } from 'vitest';
import { convertFileSrc } from '@tauri-apps/api/core';
import { resolveAgentIconSrc } from '../agentApi';
import { DEFAULT_AGENT_ICON } from '@/shared/utils/agents';

describe('resolveAgentIconSrc', () => {
  it('returns null for empty icon', () => {
    expect(resolveAgentIconSrc(null)).toBeNull();
    expect(resolveAgentIconSrc(undefined)).toBeNull();
    expect(resolveAgentIconSrc('')).toBeNull();
  });

  it('returns preset asset url for known icon names', () => {
    const src = resolveAgentIconSrc(DEFAULT_AGENT_ICON);
    expect(src).toBeTruthy();
    expect(src).not.toMatch(/^asset:\/\//);
  });

  it('converts absolute custom icon paths via convertFileSrc', () => {
    const customPath = '/Users/me/Library/Application Support/com.neeko.app/agent-icons/abc.png';
    const src = resolveAgentIconSrc(customPath);

    expect(convertFileSrc).toHaveBeenCalledWith(customPath);
    expect(src).toBe(`asset://localhost/${customPath}`);
  });

  it('converts unknown non-preset icon strings as file paths', () => {
    const customPath = 'C:\\Users\\me\\AppData\\agent-icons\\xyz.svg';
    const src = resolveAgentIconSrc(customPath);

    expect(convertFileSrc).toHaveBeenCalledWith(customPath);
    expect(src).toBe(`asset://localhost/${customPath}`);
  });
});
