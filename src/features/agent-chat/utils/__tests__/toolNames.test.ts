import { describe, expect, it } from 'vitest';

import { normalizeToolName } from '../toolNames';

/**
 * 工具名归一化 —— 各 agent 框架命名差异 → Agent Chat 标准工具名。
 * historyConvert（历史恢复）与 useAgentChat（live 流）共用同一张表，
 * 保证同一工具在两条链路命中同一卡片分派（WorkRows）。
 */
describe('normalizeToolName', () => {
  it('命令类别名归一为 run_command', () => {
    for (const raw of ['exec', 'Shell', 'command', 'exec_command', 'terminal']) {
      expect(normalizeToolName(raw)).toBe('run_command');
    }
  });

  it('编辑类别名归一为 edit_file（opencode live 流 name=edit 命中 DiffCard）', () => {
    for (const raw of ['edit', 'Edit', 'multiedit', 'MultiEdit']) {
      expect(normalizeToolName(raw)).toBe('edit_file');
    }
  });

  it('写入类别名归一为 write_file', () => {
    for (const raw of ['write', 'Write']) {
      expect(normalizeToolName(raw)).toBe('write_file');
    }
  });

  it('读取类别名归一为 read_file（live 计数 searched 与 ReadCard 分派对齐）', () => {
    for (const raw of ['read', 'Read']) {
      expect(normalizeToolName(raw)).toBe('read_file');
    }
  });

  it('PascalCase 先转 snake 再查表', () => {
    expect(normalizeToolName('WebFetch')).toBe('web_fetch');
    expect(normalizeToolName('Bash')).toBe('bash');
  });

  it('未知名称原样保留（snake 形式）', () => {
    expect(normalizeToolName('foo_bar')).toBe('foo_bar');
    expect(normalizeToolName('todowrite')).toBe('todowrite');
  });
});
