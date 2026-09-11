import { describe, expect, it } from 'vitest';

import type { LspSessionState } from '@/features/lsp/store/lspStore';

import {
  aggregateStatus,
  formatInfoFooter,
  humanStatus,
  serverName,
  statusDotClass,
} from '../lspStatusFormat';

const session = (status: LspSessionState['status']): LspSessionState =>
  ({ languageId: 'go', serverName: 'gopls', status }) as LspSessionState;

describe('serverName', () => {
  it('优先使用 live 名称；缺失时回退内置表；再回退 languageId', () => {
    expect(serverName('go', 'custom-ls')).toBe('custom-ls');
    expect(serverName('go')).toBe('gopls');
    expect(serverName('go', '   ')).toBe('gopls');
    expect(serverName('brainfuck')).toBe('brainfuck');
  });
});

describe('aggregateStatus', () => {
  it('error 优先，其次 busy，最后 ready', () => {
    expect(aggregateStatus([session('ready'), session('error')])).toBe('aggregate-error');
    expect(aggregateStatus([session('ready'), session('indexing')])).toBe('aggregate-busy');
    expect(aggregateStatus([session('starting')])).toBe('aggregate-busy');
    expect(aggregateStatus([session('ready'), session('ready')])).toBe('aggregate-ready');
  });
});

describe('statusDotClass', () => {
  it('状态 → 圆点样式（busy 系带脉冲）', () => {
    expect(statusDotClass('ready')).toBe('bg-status-idle');
    expect(statusDotClass('error')).toBe('bg-status-failed');
    expect(statusDotClass('stopped')).toBe('bg-text-muted');
    expect(statusDotClass('indexing')).toContain('animate-pulse');
    expect(statusDotClass('aggregate-busy')).toContain('animate-pulse');
  });
});

describe('humanStatus', () => {
  it('状态 → 展示文案', () => {
    expect(humanStatus('ready')).toBe('Running');
    expect(humanStatus('starting')).toBe('Starting');
    expect(humanStatus('initializing')).toBe('Initializing');
    expect(humanStatus('indexing')).toBe('Indexing');
    expect(humanStatus('error')).toBe('Error');
    expect(humanStatus('stopped')).toBe('Stopped');
  });
});

describe('formatInfoFooter', () => {
  it('无 info 时只给状态文案', () => {
    expect(formatInfoFooter('ready', null)).toBe('Running');
  });

  it('有 info 时拼接版本 / commit / 构建日期 / 内存', () => {
    expect(
      formatInfoFooter('ready', {
        version: '1.2.3',
        commit: 'abc1234',
        buildDate: '2026-01-01',
        memoryMb: 250,
      } as never),
    ).toBe('Running — v1.2.3 (abc1234 2026-01-01) — 250 MB');
  });

  it('缺字段时降级为 v? 且省略空 meta', () => {
    expect(formatInfoFooter('ready', { version: null, memoryMb: 0 } as never)).toBe(
      'Running — v? — —',
    );
  });
});
