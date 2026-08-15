import { describe, expect, it } from 'vitest';

import { collapseBreadcrumb, splitBreadcrumb, type CrumbItem } from '../breadcrumb';

const PROJECT = '/Users/tomgs/RustroverProjects/neeko';
const PROJECT_NAME = 'neeko';
const measure = (text: string) => text.length * 7;

/** 把 CrumbItem 渲染成文本序列，便于断言 */
const render = (items: CrumbItem[]) => items.map((i) => i.text).join(' › ');

describe('splitBreadcrumb', () => {
  it('绝对路径：剥离项目根，根段为项目名', () => {
    const segs = splitBreadcrumb(
      `${PROJECT}/src/features/editor/components/EditorHeader.tsx`,
      PROJECT,
    );
    expect(segs).toEqual({
      root: PROJECT_NAME,
      dirs: ['src', 'features', 'editor', 'components'],
      fileName: 'EditorHeader.tsx',
    });
  });

  it('相对路径：同样剥离项目根', () => {
    const segs = splitBreadcrumb('src/app/App.tsx', PROJECT);
    expect(segs).toEqual({ root: PROJECT_NAME, dirs: ['src', 'app'], fileName: 'App.tsx' });
  });

  it('Windows 分隔符归一化为 /', () => {
    const segs = splitBreadcrumb('C:\\dev\\app\\src\\main.rs', 'C:\\dev\\app');
    expect(segs).toEqual({ root: 'app', dirs: ['src'], fileName: 'main.rs' });
  });

  it('项目根内首层文件：dirs 为空', () => {
    const segs = splitBreadcrumb(`${PROJECT}/Cargo.toml`, PROJECT);
    expect(segs).toEqual({ root: PROJECT_NAME, dirs: [], fileName: 'Cargo.toml' });
  });

  it('项目根外绝对路径：无根段，按整条路径拆分', () => {
    const segs = splitBreadcrumb('/tmp/build/cache/out/main.bundle.js', PROJECT);
    expect(segs).toEqual({
      root: null,
      dirs: ['tmp', 'build', 'cache', 'out'],
      fileName: 'main.bundle.js',
    });
  });

  it('无 projectPath：按整条路径拆分', () => {
    const segs = splitBreadcrumb('home/dev/backend/src/main.rs', null);
    expect(segs).toEqual({
      root: null,
      dirs: ['home', 'dev', 'backend', 'src'],
      fileName: 'main.rs',
    });
  });
});

describe('collapseBreadcrumb', () => {
  const segs = splitBreadcrumb(
    `${PROJECT}/src/features/editor/hooks/__tests__/staleLayoutSelfHeal.test.tsx`,
    PROJECT,
  );
  expect(segs).toEqual({
    root: PROJECT_NAME,
    dirs: ['src', 'features', 'editor', 'hooks', '__tests__'],
    fileName: 'staleLayoutSelfHeal.test.tsx',
  });

  it('宽预算：全部展开', () => {
    const items = collapseBreadcrumb(segs, 10_000, { measure });
    expect(render(items)).toBe(
      'neeko › src › features › editor › hooks › __tests__ › staleLayoutSelfHeal.test.tsx',
    );
    expect(items.every((i) => i.kind !== 'more')).toBe(true);
  });

  it('中预算：折叠中间目录为 …，保留末级目录与文件名', () => {
    const items = collapseBreadcrumb(segs, 400, { measure });
    const texts = items.map((i) => i.text);
    // 根 + … + 目录 + 文件名，文件名恒为末位
    expect(texts[0]).toBe('neeko');
    expect(texts).toContain('…');
    expect(texts[texts.length - 1]).toBe('staleLayoutSelfHeal.test.tsx');
    // 末级目录优先保留
    expect(texts).toContain('__tests__');
  });

  it('窄预算：只剩 根 + … + 文件名', () => {
    const items = collapseBreadcrumb(segs, 120, { measure });
    expect(render(items)).toBe('neeko › … › staleLayoutSelfHeal.test.tsx');
  });

  it('文件名始终是最后一个元素', () => {
    for (const budget of [10_000, 800, 500, 300, 150, 80, 40]) {
      const items = collapseBreadcrumb(segs, budget, { measure });
      const last = items[items.length - 1];
      expect(last.kind).toBe('file');
      expect(last.text).toBe('staleLayoutSelfHeal.test.tsx');
    }
  });

  it('单段路径（无项目根、无目录）：直出文件名', () => {
    const items = collapseBreadcrumb({ root: null, dirs: [], fileName: 'main.rs' }, 200, {
      measure,
    });
    expect(render(items)).toBe('main.rs');
  });
});
