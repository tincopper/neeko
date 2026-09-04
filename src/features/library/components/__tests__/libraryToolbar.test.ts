import { describe, expect, it } from 'vitest';

import { deriveSubLabel } from '../LibraryToolbar';

describe('deriveSubLabel', () => {
  it('skill/mcp 返回固定分区标签', () => {
    expect(deriveSubLabel('skill', 'installed', 'all', [])).toBe('Installed');
    expect(deriveSubLabel('mcp', 'marketplace', 'all', [])).toBe('Marketplace');
    expect(deriveSubLabel('mcp', 'installed', 'all', [])).toBe('Installed');
  });

  it('prompt 按 scopeFilter 首字母大写', () => {
    expect(deriveSubLabel('prompt', 'installed', 'global', [])).toBe('Global');
    expect(deriveSubLabel('prompt', 'installed', 'project', [])).toBe('Project');
  });

  it('prompt scope=all 无 tag 时返回 All（回归：禁止回落到项目 UUID）', () => {
    expect(deriveSubLabel('prompt', 'installed', 'all', [])).toBe('All');
  });

  it('prompt tag 过滤返回计数标签', () => {
    expect(deriveSubLabel('prompt', 'installed', 'all', ['a'])).toBe('1 tag');
    expect(deriveSubLabel('prompt', 'installed', 'all', ['a', 'b'])).toBe('2 tags');
  });
});
