import { beforeEach, describe, expect, it, vi } from 'vitest';

// invoke mock：按命令名分发
const invokeMock = vi.fn(async (cmd: string) => {
  throw new Error(`unexpected command: ${cmd}`);
});

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (cmd: string, args?: unknown) => invokeMock(cmd, args),
}));

import { loadDefinitionTargetContent } from '../api/definitionTarget';

function fileContent(path: string) {
  return { path, content: 'fn main() {}', size: 12, is_binary: false };
}

describe('loadDefinitionTargetContent — 跳转目标内容加载策略', () => {
  beforeEach(() => {
    invokeMock.mockClear();
    invokeMock.mockImplementation(async (cmd: string) => {
      throw new Error(`unexpected command: ${cmd}`);
    });
  });

  it('项目内文件：read_file_content 成功 → project-file', async () => {
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === 'read_file_content') return fileContent('src/main.rs');
      throw new Error(`unexpected: ${cmd}`);
    });

    const result = await loadDefinitionTargetContent('p1', 'rust', 'file:///proj/src/main.rs');

    expect(result).toEqual({ kind: 'project-file', content: fileContent('src/main.rs') });
  });

  it('项目外文件：read_file_content 拒绝 → 预授权读取成功 → external-readonly', async () => {
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === 'read_file_content') {
        throw new Error('Path is outside root directory');
      }
      if (cmd === 'lsp_read_preauthorized_file') return fileContent('/opt/rustlib/lib.rs');
      throw new Error(`unexpected: ${cmd}`);
    });

    const result = await loadDefinitionTargetContent('p1', 'rust', 'file:///opt/rustlib/lib.rs');

    expect(result).toEqual({
      kind: 'external-readonly',
      content: fileContent('/opt/rustlib/lib.rs'),
    });
    expect(invokeMock).toHaveBeenCalledWith('lsp_read_preauthorized_file', expect.anything());
  });

  it('项目外且预授权未命中（会话重启/旧响应）→ unavailable / outside-root', async () => {
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === 'read_file_content') throw new Error('Path is outside root directory');
      if (cmd === 'lsp_read_preauthorized_file')
        throw new Error('uri is not a pre-authorized definition target');
      throw new Error(`unexpected: ${cmd}`);
    });

    const result = await loadDefinitionTargetContent('p1', 'rust', 'file:///opt/x.rs');

    expect(result).toEqual({ kind: 'unavailable', reason: 'outside-root' });
  });

  it('普通读取失败（非项目外原因）→ unavailable / read-failed，不触发预授权', async () => {
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === 'read_file_content') throw new Error('Failed to read file: boom');
      throw new Error(`unexpected: ${cmd}`);
    });

    const result = await loadDefinitionTargetContent('p1', 'rust', 'file:///proj/missing.rs');

    expect(result).toEqual({ kind: 'unavailable', reason: 'read-failed' });
    expect(invokeMock).not.toHaveBeenCalledWith('lsp_read_preauthorized_file', expect.anything());
  });
});
