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

/**
 * 终端默认字重：300（Light），对齐 orca 的观感基准。
 *
 * 依赖打包的 JetBrains Mono Light @font-face（styles/jetbrains-mono.css）——
 * 仅设 option 不补字体面时浏览器会静默回退 400，字重不会有任何变化。
 * 用户自定义字体无 Light 面时同样回退最近可用字重，无害。
 */
export const TERMINAL_FONT_WEIGHT = 300;

/**
 * 终端行高：固定 1.0（对齐 orca 基准）。
 *
 * 历史：曾用「14px→1.2 锚点 + 随字号分段缩放」模型；对齐 orca 后统一为
 * flat 1.0 —— cell 高 = 字号 × 1（dpr 2 时 14px → 28 device px 整数），
 * 行距更紧凑，且消除 lineHeight 1.2 带来的非整数 device cell（块字形
 * 分数坐标灰边的放大器，见 .workbuddy/artifacts/neeko-terminal-block-glyph-audit.md）。
 *
 * @param _fontSize 终端字号（保留参数位以稳定调用方签名）
 * @returns xterm lineHeight 倍率（恒 1）
 */
export function resolveTerminalLineHeight(_fontSize: number): number {
  void _fontSize; // 参数位保留（调用方语义稳定），当前 flat 1.0 不随字号变化
  return 1;
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

/** 字体门闩超时：打包字体（~800KB，本地 asar）正常远快于此，纯兜底不阻塞终端。 */
const TERMINAL_FONT_GATE_TIMEOUT_MS = 3000;

/** 从 CSS font-family 栈解析首位字族（去引号），它是实际最先生效的字体。 */
function firstFamilyFromStack(stack: string): string {
  const first = stack.split(',')[0]?.trim() ?? '';
  return first.replace(/^['"]|['"]$/g, '');
}

/** 字族是否为当前文档已注册的 @font-face（web font）；系统字体不在其列。 */
function isRegisteredWebFont(family: string): boolean {
  const fonts = (typeof document !== 'undefined' ? document.fonts : undefined) as
    | { forEach(cb: (ff: { family: string }) => void): void }
    | undefined;
  if (!fonts) return false;
  let found = false;
  fonts.forEach((ff) => {
    if (!found && (ff.family ?? '').replace(/^['"]|['"]$/g, '') === family) found = true;
  });
  return found;
}

/**
 * 终端字体就绪门闩（P0-A，根治字体加载竞态）。
 *
 * 背景：终端 mono 栈首位是打包的 JetBrains Mono（@font-face，~800KB 从
 * asar 加载）。xterm 在 open() 时同步测量字体并栅格化 WebGL 纹理图集，且
 * 6.0.0 从不监听字体加载完成 —— 若打包字体未就绪就 open，测量与图集首帧
 * 都会锁死 fallback 字形（WebGL 图集缓存后不重建 → 持续显示错误字形，
 * 表现为「开 GPU 后 TUI 渲染不精细/乱码」；Canvas 每帧重绘会自愈故无此
 * 现象）。orca 用系统字体（SF Mono）无加载窗口，故同样 WebGL 却精细。
 *
 * 策略：open() 前 await 此门闩 ——
 *  - 系统字体（SF Mono/Menlo）与已加载完的 web font：check 立即通过，零延迟；
 *  - 用户配置了不存在的字体名（非 @font-face）：无加载可等，零延迟放行；
 *  - 仅对「已注册 @font-face 且仍在加载」的字体等待终端字重（TERMINAL_FONT_WEIGHT
 *    300）+ bold 两档就绪（xterm 常规/粗体两路字形），超时兜底。
 * 失败/超时一律静默放行（不阻塞终端创建），遗漏由 P0-B（font-ready 兜底
 * heal，见 shared/utils/terminal.ts registerFontsReadyHeal）收口。
 */
export async function ensureTerminalFontsReady(
  fontStack: string,
  fontSize: number,
  timeoutMs: number = TERMINAL_FONT_GATE_TIMEOUT_MS,
): Promise<void> {
  const fonts = (typeof document !== 'undefined' ? document.fonts : undefined) as
    | { check(font: string): boolean; load(font: string, text?: string): Promise<unknown> }
    | undefined;
  if (!fonts || typeof fonts.check !== 'function' || typeof fonts.load !== 'function') return;
  const family = firstFamilyFromStack(fontStack);
  if (!family) return;
  try {
    // 已可用（系统字体 / 加载完成的 web font）：立即放行。
    // 按终端实际字重 300 探测——xterm 以该字重测量 + 烘焙图集，等错档等于没等。
    if (fonts.check(`${TERMINAL_FONT_WEIGHT} ${fontSize}px "${family}"`)) return;
    if (!isRegisteredWebFont(family)) return;
    // 打包字体加载中：等终端字重 + bold 就绪（任一失败不阻塞，走超时/静默）
    const sample = 'Ag0123456789';
    const loadNormal = fonts
      .load(`${TERMINAL_FONT_WEIGHT} ${fontSize}px "${family}"`, sample)
      .catch(() => undefined);
    const loadBold = fonts.load(`bold ${fontSize}px "${family}"`, sample).catch(() => undefined);
    await Promise.race([
      Promise.all([loadNormal, loadBold]),
      new Promise<void>((resolve) => {
        setTimeout(resolve, timeoutMs);
      }),
    ]);
  } catch {
    // 探测异常（罕见）：静默放行，交由 P0-B 兜底
  }
}

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
