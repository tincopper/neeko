import { describe, expect, it } from 'vitest';

import { hostFromUrl } from '../browserUtils';

describe('hostFromUrl — tab 标题兜底', () => {
  it('提取 http URL 的 hostname', () => {
    expect(hostFromUrl('https://github.com/neeko/dashboard')).toBe('github.com');
    expect(hostFromUrl('http://localhost:1420/editor')).toBe('localhost');
  });

  it('空串返回空串', () => {
    expect(hostFromUrl('')).toBe('');
  });

  it('解析失败时回退为原始 URL', () => {
    expect(hostFromUrl('not a url')).toBe('not a url');
  });

  it('file:// 无 host 时回退为原始 URL', () => {
    expect(hostFromUrl('file:///Users/me/index.html')).toBe('file:///Users/me/index.html');
  });

  it('带 www 子域保留完整 hostname', () => {
    expect(hostFromUrl('https://www.example.com/path')).toBe('www.example.com');
  });
});
