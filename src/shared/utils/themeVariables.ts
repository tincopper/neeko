/**
 * 主题变量的**契约**（单一数据源）。
 *
 * ## 为什么需要它
 *
 * 同一组变量名在仓库里有三份独立维护的清单，且已经漂移：
 *
 * | 位置 | 数量 | 用途 |
 * | --- | --- | --- |
 * | `styles/themes/*.css` 的 5 个主题文件 | 59 | CSS 定义 |
 * | `app/bootstrap/customThemeVars.ts` 的 `CUSTOM_CSS_VARS` | **31** | 自定义主题可覆盖哪些 |
 * | `styles/__tests__/themeTokens.test.ts` | 若干 | 校验主题文件完整性 |
 *
 * 后果是实测出来的：用户做自定义主题后，**28 个变量无法覆盖** ——
 * 包括全部 19 个 CodeMirror 语法色（`--cm-*`）、`--mono-fg`、`--switch-track`、
 * `--border-subtle` 与 3 个 `-rgb` 变体。编辑器语法高亮、终端前景色、
 * Switch 轨道、弱分割线全部仍是内置主题的值，用户无法调。
 *
 * 三份清单各自维护，改一处漏两处是必然的。本模块把变量名收敛为唯一来源，
 * 另外两处从它派生。
 *
 * ## 两层契约
 *
 * 变量分两类，因为它们的**语义不同**：
 *
 * - `THEME_VARIABLES` —— 每个内置主题块**必须全部定义**的变量。
 *   缺任何一个，`var(--x)` 会回退为继承值，表现为「颜色静默失效」。
 * - `CUSTOM_THEME_OVERRIDABLE` —— 自定义主题**允许覆盖**的变量。
 *   它是 `THEME_VARIABLES` 的子集，因为少数变量有外部耦合，覆盖会破坏其他机制
 *   （见该常量的注释）。
 *
 * 子集关系由单测强制（`themeContract.test.ts`），不是靠人记。
 */

/**
 * 主题块的完整变量清单，按语义分组。
 *
 * 分组只是可读性；校验时按并集处理。**新增主题变量必须加到这里**，
 * 否则 `themeTokens.test.ts` 会报「契约里有、CSS 里没有」。
 */
export const THEME_VARIABLE_GROUPS = {
  /** Titlebar 渐变色 */
  titlebar: ['--titlebar-gradient-start'],

  /** 表面层级：primary（海面）→ secondary（浮岛）→ tertiary（浮岛内区块） */
  surface: [
    '--bg-primary',
    '--bg-gradient-start',
    '--bg-gradient-end',
    '--bg-secondary',
    '--bg-tertiary',
    '--bg-hover',
    '--bg-selected',
  ],

  /** 文字层级 */
  text: [
    '--text-primary',
    '--text-secondary',
    '--text-muted',
    '--border-subtle',
    '--mono-fg',
    '--mono-fg-dim',
    '--text-on-accent',
  ],

  /** 边框与控件轨道 */
  border: ['--border-color', '--switch-track'],

  /**
   * 代码文本前景色（正文里的等宽文本：行内代码 / 键名等）。
   *
   * 为什么独立成位（两个方向都试过，均不成立）：
   * ① 复用 `--accent-*`：accent 是强调 / 状态语义，中等亮度高饱和，压在浅色表面上
   *    正文级不达标（light 2.84 / claude 3.04）；
   * ② 复用 `--mono-fg`：one-dark-pro 里它与 `--text-primary` 同值（#abb2bf），
   *    代码与正文完全分不开（2026-11 用户反馈「字体颜色没有了，区分不了」）。
   * 判据：`styles/__tests__/themeTokens.test.ts`「行内代码前景色」—— 对比度 ≥ 4.5（读得清）、
   * ΔE ≥ 0.10 vs 正文（看得出）、色相/彩度取自本主题调色板某个槽位（±6°、彩度 ≥ 60%）、
   * 且与链接色 ΔE ≥ 0.12（不长得像链接）。槽位逐主题自选（琥珀 / 紫 / 砖红 / 绿），
   * **不是固定某个色** —— 固定槽位会让五个主题同色。
   */
  code: ['--code-inline-fg'],

  /** 终端选区 */
  terminal: ['--terminal-selection'],

  /**
   * Accent 色板。
   *
   * `-rgb` 变体是给 `rgba(var(--x-rgb), α)` 用的（CodeMirror 选区、动画、编辑器
   * 高亮），**必须与主色手工同步**。这是已知的重复数据点：改主色时若忘了改
   * `-rgb`，半透明场景会用旧颜色。
   */
  accent: [
    '--accent-blue',
    '--accent-blue-rgb',
    '--accent-green',
    '--accent-green-rgb',
    '--accent-yellow',
    '--accent-red',
    '--accent-red-rgb',
    '--accent-orange',
    '--accent-brick',
    '--accent-brick-rgb',
  ],

  /** Git 文件状态色板（独立于 accent，改状态色不牵动主题主色） */
  gitStatus: [
    '--git-status-added',
    '--git-status-modified',
    '--git-status-deleted',
    '--git-status-untracked',
    '--git-status-conflict',
  ],

  /** 运行状态 */
  status: ['--status-idle', '--status-running', '--status-failed'],

  /** Diff 底色与文字色 */
  diff: ['--diff-added', '--diff-removed', '--diff-added-text', '--diff-removed-text'],

  /** CodeMirror 语法高亮（19 个） */
  codeMirror: [
    '--cm-keyword',
    '--cm-comment',
    '--cm-string',
    '--cm-number',
    '--cm-operator',
    '--cm-variableName',
    '--cm-typeName',
    '--cm-propertyName',
    '--cm-function',
    '--cm-className',
    '--cm-definition',
    '--cm-string2',
    '--cm-meta',
    '--cm-attribute',
    '--cm-tag',
    '--cm-atom',
    '--cm-bool',
    '--cm-punctuation',
    '--cm-bracket',
  ],
} as const;

/** 主题块必须定义的完整变量清单（分组展平后的唯一来源） */
export const THEME_VARIABLES: readonly string[] = Object.values(THEME_VARIABLE_GROUPS).flat();

/**
 * 不允许自定义主题覆盖的变量。**当前为空。**
 *
 * 存在的意义：若将来某个变量出现外部耦合（例如被 Rust 侧读取、
 * 或被 `syncTypographyTokens` 接管），需要一个「在这里登记并写明理由」的位置，
 * 而不是让排除逻辑散落在消费方。
 *
 * 登记前先问：这个变量真的**不能**由用户调吗？多数情况答案是「能」——
 * 2026-10-28 前的实现把 28 个变量（含全部 19 个 `--cm-*` 语法色）挡在外面，
 * 用户做自定义主题后编辑器语法高亮调不动，且界面没有任何提示。
 *
 * 每项都必须存在于 `THEME_VARIABLES`（单测强制，防拼错）。
 */
export const CUSTOM_THEME_EXCLUDED: readonly string[] = [];

/**
 * 自定义主题允许覆盖的变量 = 契约全集 − 排除项。
 *
 * 消费方：`app/bootstrap/customThemeVars.ts`（写入 `documentElement`）。
 *
 * 注意 `--font-*` / `--line-height-*` 不在契约里：它们由 `syncTypographyTokens`
 * 在运行期写入，不属于「主题配色」范畴。
 */
export const CUSTOM_THEME_OVERRIDABLE: readonly string[] = THEME_VARIABLES.filter(
  (token) => !CUSTOM_THEME_EXCLUDED.includes(token),
);
