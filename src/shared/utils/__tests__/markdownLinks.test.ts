import { describe, expect, it } from 'vitest';

import { resolveInternalHref } from '@/shared/utils/markdownLinks';

describe('resolveInternalHref markdown 内部相对链接 → 绝对路径', () => {
  const base = '/ws/proj/docs';

  it('./ 相对路径拼接 basePath', () => {
    expect(resolveInternalHref('./guide.md', base)).toBe('/ws/proj/docs/guide.md');
  });

  it('裸文件名相对路径', () => {
    expect(resolveInternalHref('guide.md', base)).toBe('/ws/proj/docs/guide.md');
  });

  it('../ 上跳一层', () => {
    expect(resolveInternalHref('../README.md', base)).toBe('/ws/proj/README.md');
  });

  it('多级 ../ 上跳', () => {
    expect(resolveInternalHref('../../top.md', base)).toBe('/ws/top.md');
  });

  it('绝对路径直接返回并规范化反斜杠', () => {
    expect(resolveInternalHref('/abs/a.md', base)).toBe('/abs/a.md');
    expect(resolveInternalHref('C:\\ws\\a.md', base)).toBe('C:/ws/a.md');
  });

  it('# 锚点去掉 hash 保留路径部分', () => {
    expect(resolveInternalHref('./a.md#section', base)).toBe('/ws/proj/docs/a.md');
  });

  it('# 纯锚点返回空（无可打开文件）', () => {
    expect(resolveInternalHref('#section', base)).toBe('');
  });

  it('特殊协议（mailto/文件协议）返回空', () => {
    expect(resolveInternalHref('mailto:a@b.com', base)).toBe('');
    expect(resolveInternalHref('file:///tmp/x.md', base)).toBe('');
  });

  it('反斜杠路径规范化', () => {
    expect(resolveInternalHref('.\\sub\\a.md', base)).toBe('/ws/proj/docs/sub/a.md');
  });

  it('basePath 尾部斜杠处理', () => {
    expect(resolveInternalHref('./a.md', '/ws/proj/docs/')).toBe('/ws/proj/docs/a.md');
  });

  it('空 href 返回空字符串', () => {
    expect(resolveInternalHref('', base)).toBe('');
  });

  it('无 basePath 时返回规范化后的 href', () => {
    expect(resolveInternalHref('./a.md', undefined)).toBe('a.md');
  });
});
