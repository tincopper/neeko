// @vitest-environment node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  CHANGE_HIGHLIGHT_SURFACES,
  FORBIDDEN_INLINE_CLASSES,
  LINE_BACKGROUND_CLASSES,
  changeHighlightViolations,
  opaqueLineBackgroundViolations,
  type ChangeHighlightSurface,
} from './changeHighlightCss';

const STYLES_DIR = resolve(__dirname, '..');

/** 把契约登记表里的一个渲染面读成「真实 CSS 源码 + 契约」 */
function surfaceOf(file: string, lineSelectors: readonly string[]): ChangeHighlightSurface {
  return { file, lineSelectors };
}

function cssOf(surface: ChangeHighlightSurface): string {
  return readFileSync(resolve(STYLES_DIR, surface.file), 'utf8');
}

/** 一个最小的合规夹具：行级底色齐备，无行内底块 */
const COMPLIANT = `
.cm-editor .cm-git-line-added { background: color-mix(in srgb, green 8%, transparent) !important; }
.cm-editor .cm-git-line-modified { background: color-mix(in srgb, blue 8%, transparent) !important; }
`;
const COMPLIANT_SURFACE = surfaceOf('fixture.css', [
  '.cm-editor .cm-git-line-added',
  '.cm-editor .cm-git-line-modified',
]);

describe('变更高亮：只做行级底色（真实文件）', () => {
  it('编辑器与 Diff 面板都合规（无行内底块、行级底色在位）', () => {
    const failures = CHANGE_HIGHLIGHT_SURFACES.flatMap((surface) =>
      changeHighlightViolations(surface, cssOf(surface)).map((v) => `${surface.file}：${v}`),
    );
    expect(failures).toEqual([]);
  });

  it('契约登记表非空，且每个渲染面都声明了行级选择器', () => {
    // 健全性：登记表被删空 / 少登记一个面时，上面的真实文件断言会静默空转
    expect(CHANGE_HIGHLIGHT_SURFACES.length).toBeGreaterThanOrEqual(2);
    for (const surface of CHANGE_HIGHLIGHT_SURFACES) {
      expect(surface.lineSelectors.length).toBeGreaterThan(0);
    }
    expect(CHANGE_HIGHLIGHT_SURFACES.map((s) => s.file)).toEqual([
      'components/editor.css',
      'components/diff.css',
    ]);
  });

  it('判据真的读到了规则（不是对空规则集判合规）', () => {
    // 反证方向：文件路径写错时 readFileSync 会抛，但如果我们误传了空 contents，
    // 「找不到行级底色规则」也必须报出来 —— 用它反推「解析确实跑过」
    const empty = changeHighlightViolations(COMPLIANT_SURFACE, '');
    expect(empty.join('|')).toContain('找不到行级底色规则');
  });
});

describe('变更高亮：行底色必须透（真实文件）', () => {
  it('编辑器 CSS 里没有任何不透明行底色 —— 否则该行拖选无高亮', () => {
    const css = cssOf(CHANGE_HIGHLIGHT_SURFACES[0]);
    expect(opaqueLineBackgroundViolations(css)).toEqual([]);
  });

  it('判据真的扫到了行底色规则（不是对空集判合规）', () => {
    // 反证方向：判据若把选择器匹配写坏，真实文件也会「零违规」—— 用一条已知不透明规则反推它确实跑过
    const opaque = opaqueLineBackgroundViolations(
      '.cm-editor .cm-activeLine.cm-git-line-modified { background: color-mix(in srgb, blue 6%, #1e1e1e) !important; }',
    );
    expect(opaque.join('|')).toContain('不透明');
  });

  it('每个行底色类名都在契约覆盖范围内（类名改名时不会静默漏管）', () => {
    const css = cssOf(CHANGE_HIGHLIGHT_SURFACES[0]);
    for (const cls of ['cm-git-line-added', 'cm-git-line-modified']) {
      expect(LINE_BACKGROUND_CLASSES).toContain(cls);
      expect(css).toContain(`.${cls}`);
    }
  });
});

describe('变更高亮：不透底色的反证（同一函数判违规）', () => {
  const translucent = [
    '.cm-editor .cm-git-line-modified { background: color-mix(in srgb, blue 8%, transparent); }',
    '.cm-editor .cm-nav-flash-line { background-color: rgba(var(--accent-blue-rgb), 0.28); }',
    '.cm-editor .cm-git-line-added { background: oklch(0.7 0.15 150 / 0.2); }',
  ];
  const opaque = [
    '.cm-editor .cm-activeLine.cm-git-line-modified { background: color-mix(in srgb, blue 6%, var(--bg-secondary)) !important; }',
    '.cm-editor .cm-git-line-added { background: #30d158; }',
    '.cm-editor .cm-git-line-added { background-color: rgba(48, 209, 88, 1); }',
  ];

  it('透明写法全部通过', () => {
    for (const css of translucent) expect(opaqueLineBackgroundViolations(css)).toEqual([]);
  });

  it('不透明写法逐条判违规', () => {
    for (const css of opaque) {
      expect(opaqueLineBackgroundViolations(css).join('|')).toContain('不透明');
    }
  });
});

describe('变更高亮：反证（坏数据必须被同一函数判违规）', () => {
  it('合规夹具通过（判据不是恒红）', () => {
    expect(changeHighlightViolations(COMPLIANT_SURFACE, COMPLIANT)).toEqual([]);
  });

  it('行内底块回潮 → 违规（三个类名逐个生效）', () => {
    for (const cls of FORBIDDEN_INLINE_CLASSES) {
      const bad = `${COMPLIANT}\n.${cls} { background: color-mix(in srgb, blue 24%, transparent); }\n`;
      const violations = changeHighlightViolations(COMPLIANT_SURFACE, bad);
      expect(violations.join('|')).toContain(cls);
    }
  });

  it('行级底色被改成只剩 color → 违规', () => {
    const bad = COMPLIANT.replace(
      'background: color-mix(in srgb, green 8%, transparent) !important;',
      'color: var(--git-status-added);',
    );
    expect(changeHighlightViolations(COMPLIANT_SURFACE, bad).join('|')).toContain(
      '必须声明 background',
    );
  });

  it('行级底色规则整条消失 → 违规', () => {
    const bad = '.cm-editor .cm-git-line-added { background: green; }';
    expect(changeHighlightViolations(COMPLIANT_SURFACE, bad).join('|')).toContain(
      '找不到行级底色规则',
    );
  });

  it('注释里提到禁用类不算违规（判据读源码，不读注释）', () => {
    const withComment = `/* 行内不做词级高亮（无 \`.word-diff-added\` / \`.cm-git-word\`）：行底色已够 */\n${COMPLIANT}`;
    expect(changeHighlightViolations(COMPLIANT_SURFACE, withComment)).toEqual([]);
  });

  it('类名前缀相同但并非同一类 → 不误判', () => {
    const lookalike = `${COMPLIANT}\n.cm-git-wordish { background: red; }\n`;
    expect(changeHighlightViolations(COMPLIANT_SURFACE, lookalike)).toEqual([]);
  });
});
