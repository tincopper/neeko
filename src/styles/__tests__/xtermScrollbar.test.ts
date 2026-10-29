// @vitest-environment node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { autohideViolations } from './xtermCss';

/**
 * 终端滚动条（xterm.css）契约守卫：半透明 + 停止滚动 3s 后淡出 + 空闲态不拦指针。
 *
 * 判据在 `./xtermCss.ts`（非测试模块），真实文件与反证用例共用同一函数。
 * 背景：xterm 自绘滚动条的显隐由它内部 VisibilityController 掌管，只在指针移出滚动区
 * 时才隐藏 —— 而终端的滚动区就是整个面板，指针停在里面时滚动条永远可见。
 */

const XTERM_CSS = readFileSync(resolve(__dirname, '../components/xterm.css'), 'utf8');

describe('终端滚动条自动隐藏（xterm.css）', () => {
  it('真实文件合规：空闲淡出 + 默认可见 + 空闲态不拦指针', () => {
    expect(autohideViolations(XTERM_CSS)).toEqual([]);
  });

  it('反证：缺少 .scroll-idle 淡出规则会被判违规', () => {
    const bad = [
      '.x .xterm-slider { opacity: 0.45; transition: opacity 240ms; }',
      '.x.scroll-idle .xterm-scrollbar { pointer-events: none; }',
    ].join('\n');
    expect(autohideViolations(bad).join('|')).toContain('缺少 .scroll-idle');
  });

  it('反证：滑块默认隐藏（极性反了）会被判违规', () => {
    const bad = [
      '.x .xterm-slider { opacity: 0; }',
      '.x.scroll-idle .xterm-slider { opacity: 0; }',
      '.x.scroll-idle .xterm-scrollbar { pointer-events: none; }',
    ].join('\n');
    const joined = autohideViolations(bad).join('|');
    expect(joined).toContain('不得默认隐藏');
    expect(joined).toContain('滑块必须半透明');
  });

  it('反证：滑块不透明（opacity: 1）会被判违规', () => {
    const bad = [
      '.x .xterm-slider { opacity: 1; }',
      '.x.scroll-idle .xterm-slider { opacity: 0; }',
      '.x.scroll-idle .xterm-scrollbar { pointer-events: none; }',
    ].join('\n');
    expect(autohideViolations(bad).join('|')).toContain('滑块必须半透明');
  });

  it('反证：空闲态没关指针会被判违规', () => {
    const bad = [
      '.x .xterm-slider { opacity: 0.45; }',
      '.x.scroll-idle .xterm-slider { opacity: 0; }',
    ].join('\n');
    expect(autohideViolations(bad).join('|')).toContain('pointer-events: none');
  });

  it('注释里提到这些声明不算违规（判据只看真规则）', () => {
    const commented = [
      '/* .xterm-slider { opacity: 0; } 只是注释 */',
      '.x .xterm-slider { opacity: 0.45; transition: opacity 240ms; }',
      '.x.scroll-idle .xterm-slider { opacity: 0; }',
      '.x.scroll-idle .xterm-scrollbar { pointer-events: none; }',
    ].join('\n');
    expect(autohideViolations(commented)).toEqual([]);
  });
});
