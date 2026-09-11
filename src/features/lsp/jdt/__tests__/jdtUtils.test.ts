import { beforeEach, describe, expect, it, vi } from 'vitest';

// invoke mock：按命令名分发
const invokeMock = vi.fn(async (cmd: string) => {
  throw new Error(`unexpected command: ${cmd}`);
});

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (cmd: string, args?: unknown) => invokeMock(cmd, args),
}));

import { isVirtualDocLifecycleMessage, readClassFileContents } from '../jdtUtils';

// 纯判定/展示路径/tab 文档 uri 测试随实现迁至 shared/utils/__tests__/jdt.test.ts。

describe('readClassFileContents — 类文件内容读取（门控命令包装）', () => {
  beforeEach(() => {
    invokeMock.mockClear();
  });

  it('调 lsp_read_class_file_contents 并返回 content 字符串', async () => {
    invokeMock.mockResolvedValueOnce({ content: 'public class System {}' });
    const uri = 'jdt://contents/java.base/java.lang/System.class?=p1';
    await expect(readClassFileContents('/repo', 'java', uri)).resolves.toBe(
      'public class System {}',
    );
    expect(invokeMock).toHaveBeenCalledWith('lsp_read_class_file_contents', {
      projectPath: '/repo',
      languageId: 'java',
      uri,
    });
  });

  it('错误上抛（调用方分类为 read-failed）', async () => {
    invokeMock.mockRejectedValueOnce(new Error('session gone'));
    await expect(readClassFileContents('/repo', 'java', 'jdt://contents/x')).rejects.toThrow(
      'session gone',
    );
  });
});

describe('isVirtualDocLifecycleMessage — 虚拟文档生命周期消息识别', () => {
  const lifecycle = (method: string, uri: string) =>
    JSON.stringify({ jsonrpc: '2.0', method, params: { textDocument: { uri } } });

  it('jdt:// uri 的 textDocument/did* 消息 → 拦截', () => {
    expect(
      isVirtualDocLifecycleMessage(lifecycle('textDocument/didOpen', 'jdt://contents/x')),
    ).toBe(true);
    expect(
      isVirtualDocLifecycleMessage(lifecycle('textDocument/didChange', 'jdt://contents/x?=p1')),
    ).toBe(true);
  });

  it('file:// uri 的生命周期消息 → 放行', () => {
    expect(
      isVirtualDocLifecycleMessage(lifecycle('textDocument/didOpen', 'file:///repo/src/A.java')),
    ).toBe(false);
  });

  it('非生命周期方法 → 放行', () => {
    expect(
      isVirtualDocLifecycleMessage(
        JSON.stringify({ jsonrpc: '2.0', method: 'textDocument/hover', params: {} }),
      ),
    ).toBe(false);
  });

  it('JSON 解析失败（畸形消息）→ 放行（容错）', () => {
    expect(isVirtualDocLifecycleMessage('{"method":"textDocument/didOpen" broken')).toBe(false);
  });
});
