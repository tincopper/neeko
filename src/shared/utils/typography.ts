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
 * mono 栈唯一默认。Linux 首选 Cascadia Code（更圆、字宽大），其余首选
 * JetBrains Mono（窄、高 x-height）。Consolas 保留作 Windows 兜底。
 */
export const MONO_DEFAULT = IS_LINUX
  ? "'Cascadia Code', 'JetBrains Mono', 'Fira Code', Consolas, monospace"
  : "'JetBrains Mono', 'Fira Code', 'Cascadia Code', Consolas, monospace";

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

/** mono 行高唯一真相（xterm / CodeMirror 对齐，theme.css --line-height-mono 同步）。 */
export const MONO_LINE_HEIGHT = 1.5;

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
  /** 用户 mono 家族覆盖（空 = 默认）。 */
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
  root.style.setProperty('--font-mono', buildMonoStack(tokens.monoFamily));
  root.style.setProperty('--font-size', `${tokens.uiFontSize}px`);
  root.style.setProperty('--terminal-font-size', `${tokens.monoFontSize}px`);
  if (tokens.monoLineHeight) {
    root.style.setProperty('--line-height-mono', String(tokens.monoLineHeight));
  }
}
