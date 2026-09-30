// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { filePathToFileUrl, fileUrlToFilePath, hostFromUrl } from '../browserUtils';

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

/**
 * `fileUrlToFilePath` 是「面板地址 → 可喂给 `pathsContainFile` 的本地路径」的适配器，
 * 形态换算归 `fileRef`（`fileRefFromLspUri`）。这里的用例钉住**旧本地实现的三处失真**：
 * 畸形 `%` 抛 URIError（入参是地址栏/页面导航来的任意 URL）、`localhost` host 产出伪路径、
 * UNC host 被丢弃（→ 永不与绝对路径命中 ⇒ 自动刷新静默失效）。
 */
describe('fileUrlToFilePath —— 面板地址 → 本地路径', () => {
  it('unix 路径保留前导斜杠', () => {
    expect(fileUrlToFilePath('file:///home/dev/proj/index.html')).toBe('/home/dev/proj/index.html');
  });

  it('Windows 盘符形态去掉前导斜杠', () => {
    expect(fileUrlToFilePath('file:///C:/dev/proj/index.html')).toBe('C:/dev/proj/index.html');
  });

  it('percent-escape 解码', () => {
    expect(fileUrlToFilePath('file:///home/dev/my%20dir/a.html')).toBe('/home/dev/my dir/a.html');
  });

  it('畸形 percent-escape 不抛错，按「不是本地文件」返回 null', () => {
    expect(() => fileUrlToFilePath('file:///home/dev/100%.html')).not.toThrow();
    expect(fileUrlToFilePath('file:///home/dev/100%.html')).toBeNull();
  });

  it('localhost host 视为本机（不产出 localhost/… 伪路径）', () => {
    expect(fileUrlToFilePath('file://localhost/home/dev/a.html')).toBe('/home/dev/a.html');
  });

  it('UNC host 不被丢弃（丢掉就永不与绝对路径命中）', () => {
    expect(fileUrlToFilePath('file://server/share/a.html')).toBe('//server/share/a.html');
  });

  it('非 file:// / 只有 scheme / jdt uri → null', () => {
    expect(fileUrlToFilePath('https://example.com/a.html')).toBeNull();
    expect(fileUrlToFilePath('file://')).toBeNull();
    expect(fileUrlToFilePath('jdt://contents/java.base/java.lang/String.class')).toBeNull();
  });

  it('与 filePathToFileUrl 往返一致（unix / Windows）', () => {
    for (const path of ['/home/dev/proj/index.html', 'C:/dev/proj/index.html']) {
      expect(fileUrlToFilePath(filePathToFileUrl(path))).toBe(path);
    }
  });
});
