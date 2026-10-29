// @vitest-environment node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { HIGHLIGHTED_NAME_CLASS } from '@/shared/utils/gitFileDecoration';
import { THEME_VARIABLES, THEME_VARIABLE_GROUPS } from '@/shared/utils/themeVariables';

import {
  INLINE_CODE_BODY,
  INLINE_CODE_FG,
  INLINE_CODE_LINK,
  INLINE_CODE_PALETTE,
  INLINE_CODE_SELECTOR,
  INLINE_CODE_SURFACES,
  inlineCodeBlocks,
  inlineCodeStyleViolations,
  inlineCodeThemeViolations,
} from './inlineCodeCss';
import {
  colorOf,
  contrastRatio,
  describeDefects,
  inspectThemeFile,
  readGlobalVars,
  parseColor,
  readThemeFiles,
  splitBlocks,
  themeFileFromSource,
} from './themeCss';

/**
 * 主题文件完整性守卫：`src/styles/themes/*.css` ↔ 变量契约。
 *
 * ## 判据
 *
 * `themes/` 下的每个 `.css` **都是主题**（不按变量数、不按有没有 accent 色判断），
 * 都必须覆盖契约里的全部变量。缺任何一个 → `var(--x)` 回退为继承色，
 * 表现为「颜色静默失效」，没有任何报错（2026-08-28 事故）。
 *
 * ## 为什么判据是纯函数
 *
 * 判据曾写成测试内的 `themes.flatMap(...)`，配套「反证」用例却自己用
 * `THEME_VARIABLES.filter(...)` 重算一遍 —— **没走判据代码路径**，
 * 于是它无论判据怎么写都会绿（假测试）。
 *
 * 现在判据是 `themeCss.ts` 的 `inspectThemeFile()`，下面的坏数据用例
 * 与真实文件断言走**同一个函数**，假绿无从产生。
 */

// 文件只读一次 —— 多个 describe 共用同一份快照
const themeFiles = readThemeFiles();
const globalVars = readGlobalVars();

describe('主题文件 ↔ 变量契约', () => {
  it('解析到 themes/ 下的全部主题文件', () => {
    // 健全性：防目录路径写错导致 themes 为空、下面所有断言空转
    expect(themeFiles.length).toBeGreaterThanOrEqual(5);
    expect(themeFiles.map((t) => t.file)).toEqual(
      expect.arrayContaining([
        'dark.css',
        'light.css',
        'one-dark-pro.css',
        'claude.css',
        'classic-dark.css',
      ]),
    );
  });

  it('每个主题文件都没有缺陷（变量完整 / 无未登记 / 有 color-scheme）', () => {
    const failures = themeFiles.flatMap((f) =>
      describeDefects(f, inspectThemeFile(f, THEME_VARIABLES)),
    );
    expect(failures).toEqual([]);
  });
});

/**
 * 坏数据用例 —— 直接喂 `inspectThemeFile`，走与真实文件相同的代码路径。
 *
 * 这些用例取代了此前「在对话里临时写 bash/python 脚本注入坏主题」的验证方式。
 * 那种脚本不进仓库、无法 review，其中一次把 `s[:-2]`（删尾部空行）当成
 * 「删闭合括号」，得出了「语法错误能容忍」的错误结论。
 */
describe('判据对坏主题的识别', () => {
  const N = THEME_VARIABLES.length;

  /**
   * 一份完整合规的主题源码：取自真实 `dark.css`，把主题名换成 `fixture`。
   *
   * **必须用 `replaceAll`** —— `dark.css` 里 `:root[data-theme="dark"]` 出现两次
   * （`color-scheme` 块 + 变量块）。用 `replace()` 只换第一处，第二处仍是
   * `data-theme="dark"`，会让下面「选择器写错」用例的 replaceAll 漏掉它、
   * 该块继续被解析到 → 用例假绿。
   */
  const validSource = readFileSync(resolve(__dirname, '../themes/dark.css'), 'utf8').replaceAll(
    'data-theme="dark"',
    'data-theme="fixture"',
  );

  it('fixture 源码本身不含原主题名（防替换漏掉）', () => {
    expect(validSource).not.toContain('data-theme="dark"');
  });

  it('完整主题无缺陷（基线，证明下面的坏数据确实只差在坏点上）', () => {
    const defects = inspectThemeFile(themeFileFromSource(validSource), THEME_VARIABLES);
    expect(describeDefects(themeFileFromSource(validSource), defects)).toEqual([]);
  });

  it('空文件：报出全部变量缺失且缺 color-scheme', () => {
    const f = themeFileFromSource('');
    const d = inspectThemeFile(f, THEME_VARIABLES);
    expect(d.missingVars).toHaveLength(N);
    expect(d.unknownVars).toEqual([]);
    expect(d.lacksColorScheme).toBe(true);
  });

  it('只有 color-scheme：仍报出全部变量缺失', () => {
    const f = themeFileFromSource(':root[data-theme="x"] {\n  color-scheme: dark;\n}\n');
    const d = inspectThemeFile(f, THEME_VARIABLES);
    expect(d.missingVars).toHaveLength(N);
    expect(d.lacksColorScheme).toBe(false); // color-scheme 本身是有的
  });

  it('只写了 1 个变量：报出 N-1 个缺失', () => {
    const f = themeFileFromSource(
      ':root[data-theme="x"] {\n  color-scheme: dark;\n  --bg-primary: #000;\n}\n',
    );
    const d = inspectThemeFile(f, THEME_VARIABLES);
    expect(d.missingVars).toHaveLength(N - 1);
    expect(d.missingVars).not.toContain('--bg-primary');
  });

  it('缺一个变量：精确指出是哪一个', () => {
    const broken = validSource.replace(/^\s*--switch-track:.*$/m, '');
    expect(broken).not.toBe(validSource); // 确认替换真的生效（防 case 写错导致空转）
    const d = inspectThemeFile(themeFileFromSource(broken), THEME_VARIABLES);
    expect(d.missingVars).toEqual(['--switch-track']);
  });

  it('变量名拼错：同时报「缺正确名」与「多错名」', () => {
    const broken = validSource.replace('--cm-bracket:', '--cm-brackets:');
    expect(broken).not.toBe(validSource);
    const d = inspectThemeFile(themeFileFromSource(broken), THEME_VARIABLES);
    expect(d.missingVars).toEqual(['--cm-bracket']);
    expect(d.unknownVars).toEqual(['--cm-brackets']);
  });

  it('多出未登记变量：报进 unknownVars', () => {
    const broken = validSource.replace('--bg-primary:', '--bg-bogus: #000;\n  --bg-primary:');
    expect(broken).not.toBe(validSource);
    const d = inspectThemeFile(themeFileFromSource(broken), THEME_VARIABLES);
    expect(d.unknownVars).toEqual(['--bg-bogus']);
    expect(d.missingVars).toEqual([]);
  });

  it('缺 color-scheme：只报缺 color-scheme，变量不受影响', () => {
    const broken = validSource.replace(/\n\s*color-scheme:[^;]+;/, '');
    expect(broken).not.toBe(validSource);
    const d = inspectThemeFile(themeFileFromSource(broken), THEME_VARIABLES);
    expect(d.lacksColorScheme).toBe(true);
    expect(d.missingVars).toEqual([]);
  });

  it('选择器写错（漏 :root）：解析不到变量块，等价于空文件', () => {
    // `splitBlocks` 只认 `^:root`；选择器写错会让整个块被漏掉。
    // 真实影响 = 该主题一个变量都没有 → 全部报缺。
    //
    // 注意必须用 replaceAll：同一个选择器在一个文件里出现两次
    // （color-scheme 块 + 变量块），只换第一处时第二个块仍能被解析到 ——
    // 那会让本用例假绿。
    const broken = validSource
      .replaceAll(':root[data-theme="fixture"]', '[data-theme="fixture"]')
      .replaceAll(':root:not([data-theme])', '.fallback');
    // 显式确认两次替换都生效（防「替换没匹配上」导致断言空转）
    expect(broken).not.toBe(validSource);
    expect(broken).not.toContain(':root[');
    expect(broken).not.toContain(':root:not(');

    const d = inspectThemeFile(themeFileFromSource(broken), THEME_VARIABLES);
    expect(d.missingVars).toHaveLength(N);
  });

  it('缺闭合括号：块解析失败，同样报出全部变量缺失', () => {
    // 这条是那次「假绿」的正身：闭合括号缺失必须被识别。
    // 构造方式显式断言「确实删掉了 }」，避免再写出删空行的错误脚本。
    const idx = validSource.replace(/\s+$/, '').lastIndexOf('}');
    expect(idx).toBeGreaterThan(-1);
    const broken = validSource.slice(0, idx) + validSource.slice(idx + 1);
    expect(broken.length).toBe(validSource.length - 1);
    expect(broken.replace(/\s+$/, '').endsWith('}')).toBe(false);

    const d = inspectThemeFile(themeFileFromSource(broken), THEME_VARIABLES);
    expect(d.missingVars).toHaveLength(N);
  });
});

/**
 * `base/variables.css` **有意**提供的兜底变量。
 *
 * 判据：未知 `data-theme`（或用户自定义主题没覆盖到的）时，这些必须有值，
 * 否则界面完全无色 / 无字体色。**这是一份显式决策，不是推断出来的**。
 *
 * 2026-10-28 教训：上一版只按「组」猜测（cm + git-status），把 `--mono-fg` /
 * `--mono-fg-dim` / `--border-subtle` 的兜底校验漏掉了 —— 它们属于 `text` 组，
 * 而 `text` 组里其余变量（`--text-primary` 等）**不该**在 :root 兜底（那是主题职责）。
 * 按组推断无法表达这种区内差异，必须逐项列出。
 */
const GLOBAL_FALLBACK_TOKENS: readonly string[] = [
  ...THEME_VARIABLE_GROUPS.codeMirror,
  ...THEME_VARIABLE_GROUPS.gitStatus,
  '--mono-fg',
  '--mono-fg-dim',
  '--border-subtle',
];

describe('base/variables.css 兜底', () => {
  it('提供每一个「有意兜底」的变量', () => {
    const missing = GLOBAL_FALLBACK_TOKENS.filter((token) => !globalVars.vars.has(token));
    expect(missing).toEqual([]);
  });

  it('不兜底其它契约变量（那是 themes/ 的职责）', () => {
    // 反向闭环：variables.css 里出现的契约变量不得超出上面的白名单，
    // 否则会变成「第二份需要与主题同步的定义」。
    const allowed = new Set(GLOBAL_FALLBACK_TOKENS);
    const leaked = THEME_VARIABLES.filter(
      (token) => !allowed.has(token) && globalVars.vars.has(token),
    );
    expect(leaked).toEqual([]);
  });

  it('定义 color-scheme 默认值（未设 data-theme 时的兜底）', () => {
    expect(globalVars.raw).toContain('color-scheme:');
  });
});

describe('Tailwind 桥接', () => {
  const bridge = readFileSync(resolve(__dirname, '../base/tailwind.css'), 'utf8');

  it('把每个 git-status token 映射为 utility 类', () => {
    // 缺一条桥接 ⇒ text-git-status-* 静默不生成（与红线 14「声明了不生效」同型）。
    const missing = THEME_VARIABLE_GROUPS.gitStatus.filter(
      (token) => !bridge.includes(`--color-${token.slice(2)}:`),
    );
    expect(missing).toEqual([]);
  });

  it('把 switch-track 映射为 utility 类', () => {
    expect(bridge).toContain('--color-switch-track:');
  });
});

describe('Switch 轨道对比度', () => {
  // 2026-10-27 用户反馈「特别在 claude、light 主题下面特别明显的不协调」：
  // 未勾选态轨道曾复用 --bg-tertiary（表面层级色），与海面对比只有
  // 1.08（light）/ 1.11（claude）—— 轨道消失，只剩一颗深色圆球漂着。
  // 判据不是「值存在」而是「真的成形」，且必须对**每个主题文件**生效。
  it('每个主题的 --switch-track 与 --bg-primary 对比度 ≥ 1.5', () => {
    const failures: string[] = [];
    for (const theme of themeFiles) {
      const bg = colorOf(theme, '--bg-primary');
      const track = colorOf(theme, '--switch-track');
      if (!bg || !track) {
        failures.push(`${theme.file} 颜色无法解析`);
        continue;
      }
      const ratio = contrastRatio(bg, track);
      if (ratio < 1.5) {
        failures.push(`${theme.file} 轨道对比 ${ratio.toFixed(2)} < 1.5（轨道会消失）`);
      }
    }
    expect(failures).toEqual([]);
  });
});

describe('选中行文件名对比度', () => {
  // 2026-10-28 用户报「选中后字体都看不清楚了」（附文件树截图，one-dark-pro 与 light 都中招）。
  // 根因：高亮行的名字色曾是 `text-accent` —— 而 `text-accent` 是 shadcn 的
  // **accent 底色 token**（`--accent = rgba(var(--accent-blue-rgb), 0.12)`），
  // 产物里就是 `.text-accent{color:var(--accent)}`，等于拿 12% 透明的字写在
  // 高亮底上（实测 5 主题全部 1.10~1.21）。
  //
  // 修法的结构性结论：高亮行名字恒为 `--text-primary`，git 状态交给行尾徽标。
  // 本断言锁住这个修法能成立的前提 —— 中性前景色在上亮底上真的看得清。
  //
  // 阀值 3.0（WCAG 1.4.11 非文本 / UI 组件级）而不是 4.5：条目标签不是正文段落，
  // 且 one-dark-pro 的选中底（#4d5666）本身就是原主题的 scrollbarSlider 亮档，
  // 实测 3.47 是五主题的下限。要提到 4.5 得重调该主题的选中档位。
  it('每个主题的 --text-primary vs --bg-selected 对比度 ≥ 3.0', () => {
    // token 名不写死 —— 从 `HIGHLIGHTED_NAME_CLASS` 反推。
    // 写死时同一个事实会变成三份清单（常量 / 本测试 / design-tokens.md），
    // 改常量而测试照旧测旧 token，会得到「绿但没用」的假保证。
    // `text-text-primary` → `--text-primary`。
    const headingToken = HIGHLIGHTED_NAME_CLASS.replace(/^text-/, '--');
    const failures: string[] = [];
    for (const theme of themeFiles) {
      const bg = colorOf(theme, '--bg-selected');
      const fg = colorOf(theme, headingToken);
      if (!bg || !fg) {
        failures.push(`${theme.file} 颜色无法解析（${headingToken} / --bg-selected）`);
        continue;
      }
      const ratio = contrastRatio(fg, bg);
      if (ratio < 3.0) {
        failures.push(`${theme.file} 选中行名字对比 ${ratio.toFixed(2)} < 3.0（名字看不清）`);
      }
    }
    expect(failures).toEqual([]);
  });
});

describe('行内代码（无底块 + 逐主题取色）', () => {
  // 需求演进：① 行内代码不要背景块（长文里 chip 堆成色带）→ ② 颜色不能与正文同色
  // （用户：「字体颜色没有了，区分不了」）→ ③ 颜色不能五个主题都一样（用户：「每个主题都是绿色的」）。
  // 判据因此分两层，且都在 `inlineCodeCss.ts` 里（styles/README.md：判据必须是纯函数，
  // 真实文件与坏数据用例走同一条代码路径）：
  //   - 样式形态：无 background；前景色取 `--code-inline-fg`；
  //   - 主题取值：读得清（≥4.5）× 看得出（ΔE ≥0.10）× 属于本主题调色板（色相 ±6°、
  //     彩度 ≥60%）× 不像链接（ΔE ≥0.12）。
  // 每个渲染面显式声明自己的行内代码选择器：markdown / lsp 用 `code:not(pre code)`，
  // agent-chat 用裸 `.rich code`（围栏代码块由 `.rich .codeblock code` / `.diff-expand code` 重置）。
  const CSS_FILES = [
    { file: 'components/markdown.css', selector: INLINE_CODE_SELECTOR },
    { file: 'components/agent-chat.css', selector: /\.rich\s+code\b/ },
    { file: 'components/lsp.css', selector: INLINE_CODE_SELECTOR },
  ].map((entry) => ({
    ...entry,
    css: readFileSync(resolve(__dirname, `../${entry.file}`), 'utf8'),
  }));

  /** 把一个主题里判据用到的 token 抽成 swatches（坏数据用例直接替换其中几项即可） */
  function swatchesOf(theme: (typeof themeFiles)[number], token = INLINE_CODE_FG) {
    const tokens = [
      token,
      ...INLINE_CODE_SURFACES,
      ...INLINE_CODE_BODY,
      INLINE_CODE_LINK,
      ...INLINE_CODE_PALETTE,
    ];
    const swatches: Record<string, ReturnType<typeof colorOf>> = {};
    for (const name of tokens) swatches[name] = colorOf(theme, name);
    return swatches;
  }

  it('三处行内代码渲染面都是「无底块 + 取契约 token」', () => {
    const failures = CSS_FILES.flatMap(({ file, css, selector }) =>
      inlineCodeStyleViolations(css, selector).map((v) => `${file}：${v}`),
    );
    expect(failures).toEqual([]);
  });

  it('每个主题的取色都过四条主题判据', () => {
    const failures = themeFiles.flatMap((theme) =>
      inlineCodeThemeViolations(theme.file, swatchesOf(theme)),
    );
    expect(failures).toEqual([]);
  });

  it('每条规则都被真的检查到（不是只测第一条）', () => {
    // lsp.css 里行内代码出现两处（hover 与签名文档）。只校验第一处会让第二处静默漂移 ——
    // 与「git 徽标三套 DOM」同型。这里钉住「每个文件的规则数」与「全部通过」。
    const counts = CSS_FILES.map(
      ({ file, css, selector }) => [file, inlineCodeBlocks(css, selector).length] as const,
    );
    expect(counts).toEqual([
      ['components/markdown.css', 1],
      ['components/agent-chat.css', 1],
      ['components/lsp.css', 2],
    ]);
  });

  it('反证：底色重新出现会被判违规', () => {
    const bad =
      '.markdown-preview code:not(pre code) { background: var(--bg-tertiary); color: var(--code-inline-fg); }';
    expect(inlineCodeStyleViolations(bad).join('|')).toContain('仍在声明 background');
  });

  it('反证：前景色写成 accent / --mono-fg / 裸值都会被判违规', () => {
    const failures: string[] = [];
    for (const value of ['var(--accent-green)', 'var(--mono-fg)', '#a626a4']) {
      const bad = `.rich code:not(pre code) { color: ${value}; }`;
      if (!inlineCodeStyleViolations(bad).join('|').includes('必须是 var(--code-inline-fg)')) {
        failures.push(`前景色写成 ${value} 未被判违规`);
      }
    }
    expect(failures).toEqual([]);
  });

  it('反证：选择器被改写、判据对象消失会被判违规（不许静默空转）', () => {
    expect(inlineCodeStyleViolations('.rich code { color: var(--code-inline-fg); }')).toHaveLength(
      1,
    );
  });

  it('反证：对比度不足 / 与正文同色 / 偏离调色板 / 撞链接 都各有明确的失败信息', () => {
    const light = themeFiles.find((t) => t.file === 'light.css');
    expect(light).toBeDefined();
    const base = swatchesOf(light!);

    // ① 对比度不足：把前景色换成浅灰（模拟「用了一个亮绿」）
    const lowContrast = { ...base, [INLINE_CODE_FG]: colorOf(light!, '--text-muted') };
    expect(inlineCodeThemeViolations('light.css', lowContrast).join('|')).toContain('对比');

    // ② 与正文同色（用户报的「区分不了」）
    const sameAsBody = { ...base, [INLINE_CODE_FG]: colorOf(light!, '--text-primary') };
    expect(inlineCodeThemeViolations('light.css', sameAsBody).join('|')).toContain('区分不了');

    // ③ 偏离本主题调色板：把一个不存在的色相当前景色
    const offPalette = { ...base, [INLINE_CODE_FG]: [0.3, 0.6, 0.9] };
    const offFailures = inlineCodeThemeViolations('light.css', offPalette).join('|');
    expect(offFailures).toContain('色相不属于本主题调色板');

    // ④ 撞链接色
    const likeLink = { ...base, [INLINE_CODE_FG]: colorOf(light!, INLINE_CODE_LINK) };
    expect(inlineCodeThemeViolations('light.css', likeLink).join('|')).toContain('会被当成链接');

    // ⑤ 缺 token（契约位被删 / 主题漏配）
    const missing = { ...base, [INLINE_CODE_FG]: null };
    expect(inlineCodeThemeViolations('light.css', missing).join('|')).toContain('无法解析');

    // ⑥ 缺宿主表面 / 缺正文色：判据不能静默跳过（否则「测了但没测到」）
    const noSurface = { ...base, '--bg-secondary': null };
    expect(inlineCodeThemeViolations('light.css', noSurface).join('|')).toContain(
      '无法解析 --bg-secondary',
    );
    const noBody = { ...base, '--text-secondary': null };
    expect(inlineCodeThemeViolations('light.css', noBody).join('|')).toContain(
      '无法解析 --text-secondary',
    );

    // ⑦ 一个调色板槽位都取不到（契约被改名）：必须报错，不能当成「合规」
    const noPalette = Object.fromEntries(
      Object.entries(base).filter(([key]) => !INLINE_CODE_PALETTE.includes(key as never)),
    );
    expect(inlineCodeThemeViolations('light.css', noPalette).join('|')).toContain(
      '找不到任何可比的调色板槽位',
    );

    // ⑧ 色相对得上但被打灰（彩度坍缩）：同色相、C 从 0.19 掉到 0.02
    const washed = { ...base, [INLINE_CODE_FG]: parseColor('oklch(0.55 0.02 329)') };
    expect(inlineCodeThemeViolations('light.css', washed).join('|')).toContain('洗淡成灰');

    // ⑨ 缺链接色：跳过该条判据即可，不得报错（链接色缺失不是行内代码的缺陷）
    const noLink = Object.fromEntries(
      Object.entries(base).filter(([key]) => key !== INLINE_CODE_LINK),
    );
    expect(
      inlineCodeThemeViolations('light.css', noLink).filter((v) => v.includes('链接色')),
    ).toEqual([]);
  });

  it('嵌套块（`& b { ... }`）不会让规则块被截断在半路', () => {
    const nested =
      '.x code:not(pre code) { color: var(--code-inline-fg); & b { color: var(--accent-red); } }';
    expect(inlineCodeBlocks(nested)).toHaveLength(1);
    expect(inlineCodeStyleViolations(nested)).toEqual([]);
  });

  it('反证：选择器命中但规则块没写完（CSS 截断）时，判据报「对象消失」而不是崩溃', () => {
    expect(inlineCodeBlocks('.x code:not(pre code)')).toEqual([]);
    expect(inlineCodeStyleViolations('.x code:not(pre code)')).toHaveLength(1);
  });
});

describe('CSS 解析器自检', () => {
  it('注释不是源码：注释里的变量赋值 / :root 块 / color-scheme 都不得被当真', () => {
    // 2026-10-28：主题注释里写了一句 `--terminal-bg: var(--bg-secondary)`，
    // 正则的 `[^;]+` 跨行吃到下一行的 `;`，把一个**根本不存在于该主题的变量**
    // 报成「多出未登记变量」；同一个格式下注释举例的 `:root {}`
    // 与提到 `color-scheme:` 的一句话也会分别造成假块与假通过。
    const css = [
      '/* 这里只是解释：`--ghost-token: var(--bg-secondary)` 是耦合说明 */',
      '/* :root[data-theme="fake"] { --also-ghost: #fff; } */',
      '/* 本主题会不会漏配 color-scheme: 看下一块 */',
      ':root[data-theme="real"] { --bg-primary: #000; }',
    ].join('\n');
    const blocks = splitBlocks(css);
    expect(blocks).toHaveLength(1);
    expect(new Set(blocks.flatMap((b) => b.vars))).toEqual(new Set(['--bg-primary']));
    expect(inspectThemeFile(themeFileFromSource(css), ['--bg-primary']).lacksColorScheme).toBe(
      true,
    );
  });

  it('能处理跨行选择器与同文件多块', () => {
    const css = [
      ':root[data-theme="a"],',
      ':root:not([data-theme]) {',
      '  color-scheme: dark;',
      '}',
      ':root[data-theme="a"],',
      ':root:not([data-theme]) {',
      '  --bg-primary: #000;',
      '  --text-primary: #fff;',
      '}',
    ].join('\n');
    const blocks = splitBlocks(css);
    expect(blocks).toHaveLength(2);
    expect(blocks[0]?.vars).toEqual([]); // color-scheme 块无变量
    expect(blocks[1]?.vars).toEqual(['--bg-primary', '--text-primary']);
    // 按文件合并后，两块并集的变量才是该主题的完整定义
    expect(new Set(blocks.flatMap((b) => b.vars)).size).toBe(2);
  });
});
