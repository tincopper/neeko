// @vitest-environment node
import { describe, expect, it } from 'vitest';

import type { LspSessionState } from '@/features/lsp/store/lspStore';

import {
  aggregateStatus,
  chipPresentation,
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

/**
 * 状态栏 chip 展示决策（纯函数）：label / tooltip / 重试入口。
 * 组件据此只做渲染，派生逻辑在此受测（M2 / AC2 错误矩阵）。
 */
describe('chipPresentation', () => {
  it('单会话 error 带 message：label 用 message，title 携带完整文案 + 管理提示', () => {
    const chip = chipPresentation([
      { ...session('error'), statusMessage: 'gopls exited unexpectedly' },
    ]);
    expect(chip.label).toBe('gopls exited unexpectedly');
    expect(chip.title).toBe('gopls exited unexpectedly (click to manage)');
    expect(chip.retry).toEqual({ languageId: 'go', label: 'Restart gopls' });
  });

  it('单会话 error 无 message：降级为「服务器名 Error」，重试入口不依赖 message', () => {
    const chip = chipPresentation([session('error')]);
    expect(chip.label).toBe('gopls Error');
    expect(chip.title).toBe('gopls Error (click to manage)');
    expect(chip.retry).toEqual({ languageId: 'go', label: 'Restart gopls' });
  });

  it('单会话 error 用 live serverName 覆盖内置名', () => {
    const chip = chipPresentation([{ languageId: 'go', serverName: 'custom-ls', status: 'error' }]);
    expect(chip.label).toBe('custom-ls Error');
    expect(chip.retry?.label).toBe('Restart custom-ls');
  });

  it('单会话 busy（starting/initializing/indexing）拼接状态文案，无重试入口', () => {
    for (const [status, human] of [
      ['starting', 'Starting'],
      ['initializing', 'Initializing'],
      ['indexing', 'Indexing'],
    ] as const) {
      const chip = chipPresentation([session(status)]);
      expect(chip.label).toBe(`gopls ${human}`);
      expect(chip.retry).toBeNull();
    }
  });

  it('单会话 ready：只显示服务器名，title 为管理提示', () => {
    const chip = chipPresentation([session('ready')]);
    expect(chip.label).toBe('gopls');
    expect(chip.title).toBe('Click to manage LSP servers');
    expect(chip.retry).toBeNull();
  });

  it('多会话：只报数量，重试入口归下拉行（不在 chip 上暴露）', () => {
    const chip = chipPresentation([session('ready'), session('error')]);
    expect(chip.label).toBe('2 LSPs');
    expect(chip.title).toBe('2 LSPs');
    expect(chip.retry).toBeNull();
  });

  it('空输入不抛错（组件在调用前已 guard，纯函数仍需防御）', () => {
    const chip = chipPresentation([]);
    expect(chip.label).toBe('');
    expect(chip.retry).toBeNull();
  });
});
