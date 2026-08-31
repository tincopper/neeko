/**
 * Typography — 字体系统唯一真相层（SSOT）。
 *
 * 设计原则：
 * 1. 单点真相：UI sans 与 mono 各只有一个规范默认栈，其余全部是消费者。
 * 2. 角色驱动：消费方声明「UI sans / mono」角色，不声明字体文件。
 * 3. 正交独立：族（family）/ 号（size）/ 高（line-height）各自 token。
 *
 * 与 theme.css 的同步约定（两处必须保持一致）：
 * - `MONO_DEFAULT`  ↔ `--font-mono`（theme.css 静态默认）
 * - `SANS_DEFAULT`  ↔ `--font-ui`（theme.css 静态默认）
 * 运行时由 `syncTypographyTokens` 用 buildMonoStack/buildSansStack 覆盖 `--font-mono`，
 * 使所有 `var(--font-mono)` 消费方与 Tailwind `font-mono` 工具类统一跟随用户设置。
 */

const IS_LINUX = navigator.platform.toLowerCase().startsWith('linux');

/** UI 比例无衬线栈（与 base.css body 原硬编码一致）。 */
export const SANS_DEFAULT =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

/**
 * mono 栈唯一默认。首位为应用打包的 JetBrains Mono（@font-face，见
 * styles/jetbrains-mono.css）——不依赖系统安装，杜绝 fallback 链漂移导致
 * 的同屏双字体。Menlo 为 macOS 确定存在的兜底；Consolas 保留作 Windows 兜底。
 */
export const MONO_DEFAULT = IS_LINUX
  ? "'JetBrains Mono', 'Cascadia Code', 'Fira Code', Menlo, Consolas, monospace"
  : "'JetBrains Mono', 'Fira Code', 'Cascadia Code', Menlo, Consolas, monospace";

/** Nerd Font Symbols 图标 fallback（@font-face unicode-range 仅对 PUA 码点生效）。 */
const NERD_FALLBACK = "'NerdFontSymbols'";

/** 构造 mono 生效栈：用户覆盖 → 默认栈 → Nerd 图标 fallback。 */
export function buildMonoStack(userOverride: string): string {
  const base = userOverride ? `'${userOverride}', ${MONO_DEFAULT}` : MONO_DEFAULT;
  return `${base}, ${NERD_FALLBACK}`;
}

/** 构造 UI sans 生效栈（预留 UI 字体定制；本期默认仅系统栈）。 */
export function buildSansStack(userOverride: string): string {
  return userOverride ? `'${userOverride}', ${SANS_DEFAULT}` : SANS_DEFAULT;
}

/** mono 行高：编辑器 / markdown（theme.css --line-height-mono 同步）。 */
export const MONO_LINE_HEIGHT = 1.5;
/** 终端行高基准：14px 字号时的倍率（既有观感锚点）。 */
export const TERMINAL_LINE_HEIGHT_BASE = 1.2;

/**
 * 终端行高倍率随字号缩放。
 *
 * xterm 的行高 = 字号 × lineHeight（倍率）。固定倍率下：小字号行距占比过大
 * （「行高很高」），大字号行距占比过小（「挨得很近」）。改为分段线性——
 * 以 14px 的 1.2 为锚点，字号每偏离 1px 倍率反向调整，并保证像素行距
 * （size × 倍率）不低于可读下限。
 *
 * @param fontSize 终端字号（px，合法范围 10–24）
 * @returns xterm lineHeight 倍率（两位小数）
 */
export function resolveTerminalLineHeight(fontSize: number): number {
  // 像素行距模型：base(14) × 1.2 = 16.8px 锚点；字号每 +1px，像素行距 +0.6px
  // （而非 +1.2px 全额跟随）→ 倍率随之递减；-1px 同理反向，保住松散下限。
  const BASE_SIZE = 14;
  const BASE_LINE_HEIGHT = TERMINAL_LINE_HEIGHT_BASE;
  const PX_PER_SIZE_STEP = 0.6;

  const pixelSpacing = BASE_SIZE * BASE_LINE_HEIGHT + (fontSize - BASE_SIZE) * PX_PER_SIZE_STEP;
  // 倍率 = 像素行距 / 字号，两位小数（xterm options 无所谓精度，稳定比较友好）
  return Math.round((pixelSpacing / fontSize) * 100) / 100;
}

/** 字号合法范围（与 Settings 滑杆一致）。 */
const FONT_SIZE_MIN = 10;
const FONT_SIZE_MAX = 24;

function isValidFontSize(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v >= FONT_SIZE_MIN && v <= FONT_SIZE_MAX;
}

function clampFontSize(v: number): number {
  return Math.min(FONT_SIZE_MAX, Math.max(FONT_SIZE_MIN, Math.round(v)));
}

/**
 * 字号派生：terminal 默认 = ui + 2。非法/缺失值回退到派生值。
 */
export function resolveTerminalFontSize(ui: number, terminal?: number | null): number {
  if (isValidFontSize(terminal)) return terminal;
  const base = isValidFontSize(ui) ? ui : 12;
  return clampFontSize(base + 2);
}

/**
 * 字号派生：editor 默认 = terminal。非法/缺失值回退到 terminal。
 */
export function resolveEditorFontSize(terminal: number, editor?: number | null): number {
  if (isValidFontSize(editor)) return editor;
  return isValidFontSize(terminal) ? terminal : clampFontSize(14);
}

/** 批量派生：一次得到和谐的 terminal/editor 字号。 */
export function resolveEffectiveSizes(
  ui: number,
  terminal?: number | null,
  editor?: number | null,
): { terminal: number; editor: number } {
  const t = resolveTerminalFontSize(ui, terminal);
  const e = resolveEditorFontSize(t, editor);
  return { terminal: t, editor: e };
}

/** 兼容别名：旧名（若有调用方 import） */
export const resolveEffectiveFontSizes = resolveEffectiveSizes;

/** 字体 token 输入：一次同步所需的全部轴。 */
export interface TypographyTokens {
  /**
   * 用户 mono 家族覆盖（空 = 默认）。
   * @deprecated 全局 --font-mono 已固定为默认栈（防泄漏到应用 UI），
   * 终端/编辑器各自通过 buildMonoStack(config.monoFontFamily) 按需覆盖。
   * 保留字段仅为向后兼容，syncTypographyTokens 内显式 void 以消除死参告警。
   */
  monoFamily: string;
  /** UI 角色字号。 */
  uiFontSize: number;
  /** mono 角色字号。 */
  monoFontSize: number;
  /** mono 行高（可选，xterm/CodeMirror 对齐）。 */
  monoLineHeight?: number;
}

/**
 * 单一写入口：把生效字体栈 / 字号 / 行高写入 CSS 变量。
 * useAppConfig 是唯一调用方；CSS 消费者与 Tailwind `font-mono` 类自动跟随。
 */
export function syncTypographyTokens(tokens: TypographyTokens): void {
  const root = document.documentElement;
  // --font-mono 是「应用等宽 UI 角色」（输入框/列表/代码块等 font-mono 消费方），
  // 固定默认栈——终端字体的自定义由终端/编辑器显式传 buildMonoStack(config.monoFontFamily)，
  // 不得泄漏到全局角色（否则改终端字体连应用 UI 一起变）。
  void tokens.monoFamily;
  root.style.setProperty('--font-mono', buildMonoStack(''));
  root.style.setProperty('--font-size', `${tokens.uiFontSize}px`);
  root.style.setProperty('--terminal-font-size', `${tokens.monoFontSize}px`);
  if (tokens.monoLineHeight) {
    root.style.setProperty('--line-height-mono', String(tokens.monoLineHeight));
  }
  // 终端紧凑行高随字号动态派生，与 xterm 的 resolveTerminalLineHeight 保持一致
  root.style.setProperty(
    '--line-height-terminal',
    String(resolveTerminalLineHeight(tokens.monoFontSize)),
  );
}
