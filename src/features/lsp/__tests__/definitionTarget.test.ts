// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

// invoke mock：按命令名分发
const invokeMock = vi.fn(async (cmd: string) => {
  throw new Error(`unexpected command: ${cmd}`);
});

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (cmd: string, args?: unknown) => invokeMock(cmd, args),
}));

import { jdtClassFileDisplayName, loadDefinitionTargetContent } from '../api/definitionTarget';

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

    const result = await loadDefinitionTargetContent(
      'uuid-1',
      '/repo',
      'rust',
      'file:///proj/src/main.rs',
    );

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

    const result = await loadDefinitionTargetContent(
      'uuid-1',
      '/repo',
      'rust',
      'file:///opt/rustlib/lib.rs',
    );

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

    const result = await loadDefinitionTargetContent('uuid-1', '/repo', 'rust', 'file:///opt/x.rs');

    expect(result).toEqual({ kind: 'unavailable', reason: 'outside-root' });
  });

  it('普通读取失败 → 也尝试预授权（授权表为权威裁决），未命中 → read-failed', async () => {
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === 'read_file_content') throw new Error('Failed to read file: boom');
      if (cmd === 'lsp_read_preauthorized_file') throw new Error('not pre-authorized');
      throw new Error(`unexpected: ${cmd}`);
    });

    const result = await loadDefinitionTargetContent(
      'uuid-1',
      '/repo',
      'rust',
      'file:///proj/missing.rs',
    );

    expect(result).toEqual({ kind: 'unavailable', reason: 'read-failed' });
    expect(invokeMock).toHaveBeenCalledWith('lsp_read_preauthorized_file', expect.anything());
  });

  it('远程/WSL 项目外文件（错误标记不同）→ 预授权命中同样打开只读', async () => {
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === 'read_file_content') throw new Error('Failed to read file content: exit 1');
      if (cmd === 'lsp_read_preauthorized_file')
        return {
          path: '/opt/go/src/x.go',
          content: 'package main',
          size: 12,
          is_binary: false,
        };
      throw new Error(`unexpected: ${cmd}`);
    });

    const result = await loadDefinitionTargetContent(
      'uuid-1',
      '/repo',
      'go',
      'file:///opt/go/src/x.go',
    );

    expect(result).toEqual({
      kind: 'external-readonly',
      content: { path: '/opt/go/src/x.go', content: 'package main', size: 12, is_binary: false },
    });
  });
  it('双键空间：常规读取用 projectId(UUID)，预授权用 projectPath(path)', async () => {
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === 'read_file_content') throw new Error('Path is outside root directory');
      if (cmd === 'lsp_read_preauthorized_file') return fileContent('/opt/x.rs');
      throw new Error(`unexpected: ${cmd}`);
    });

    const result = await loadDefinitionTargetContent('uuid-1', '/repo', 'rust', 'file:///opt/x.rs');

    expect(result.kind).toBe('external-readonly');
    expect(invokeMock).toHaveBeenCalledWith(
      'read_file_content',
      expect.objectContaining({ projectId: 'uuid-1' }),
    );
    expect(invokeMock).toHaveBeenCalledWith(
      'lsp_read_preauthorized_file',
      expect.objectContaining({ projectPath: '/repo' }),
    );
  });
});

describe('jdt:// 类文件目标 — 显示名解析与内容加载', () => {
  beforeEach(() => {
    invokeMock.mockClear();
    invokeMock.mockImplementation(async (cmd: string) => {
      throw new Error(`unexpected command: ${cmd}`);
    });
  });

  // isJdtUri / jdtDisplayPath 纯函数判定已迁 JdtUtils（jdt/__tests__/jdtUtils.test.ts）
  it('显示名取 ? 查询串之前路径的最后一段', () => {
    expect(
      jdtClassFileDisplayName('jdt://contents/java.base/java.lang/System.class?=p1/=src/Main.java'),
    ).toBe('System.class');
    // 无查询串时取路径末段
    expect(jdtClassFileDisplayName('jdt://contents/java.base/java/util/List.class')).toBe(
      'List.class',
    );
  });

  it('jdt 目标：不走常规读取，直接调 lsp_read_class_file_contents → external-readonly（uri 即 path）', async () => {
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === 'lsp_read_class_file_contents') return { content: 'public class System {}' };
      throw new Error(`unexpected: ${cmd}`);
    });

    const uri = 'jdt://contents/java.base/java.lang/System.class?=p1/=src/Main.java';
    const result = await loadDefinitionTargetContent('uuid-1', '/repo', 'java', uri);

    expect(result).toEqual({
      kind: 'external-readonly',
      content: {
        path: uri,
        content: 'public class System {}',
        size: new TextEncoder().encode('public class System {}').byteLength,
        is_binary: false,
      },
    });
  });

  it('jdt 目标：classContents 失败（会话重启等）→ unavailable / read-failed', async () => {
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === 'lsp_read_class_file_contents') throw new Error('session gone');
      throw new Error(`unexpected: ${cmd}`);
    });

    const result = await loadDefinitionTargetContent(
      'uuid-1',
      '/repo',
      'java',
      'jdt://contents/java.base/java.lang/System.class?=x',
    );

    expect(result).toEqual({ kind: 'unavailable', reason: 'read-failed' });
  });
});
