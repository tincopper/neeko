import type { LspDiagnostic } from '../types';

/**
 * 行尾 code 徽标的展示模型（Problems 面板行 / 编辑器 hover popup 共用）。
 *
 * 规则**跨语言一致**，不做任何语言特判（红线 15）：判断只落在
 * 「这份 code 是不是给人看的」这一层，不看它来自哪个服务器。
 */
export interface DiagnosticCodeBadge {
  /** 展示文案（调用方自行补括号）。 */
  label: string;
  /** 有值时渲染为可点链接（打开服务器声明的诊断文档）。 */
  href?: string;
}

/** 数字 code 带文档链接、却没有 source 名可用的兜底文案。 */
const NUMERIC_CODE_LINK_LABEL = 'docs';

const NUMERIC = /^\d+$/;

/**
 * `LspDiagnostic` → 展示徽标；`null` = 不渲染。
 *
 * 服务器给的 `code` 有两种族，**形态上无法区分**（两者都可能是纯数字）：
 * - **人类可读**（Go 的 `UndeclaredName`、TS 的 `2339`）：原样展示，有
 *   `codeDescription.href` 时渲染成链接（VS Code 同款）。
 * - **机器标识**（jdtls 把 Eclipse `IProblem` 的内部 ID 当 code 发出，典型
 *   `16777218` = `0x01000002`）：编译器内部编号，摆在消息行上只有噪音。
 *
 * 数字 code 一律**不作为行内文案**（选它的理由：同一份数字对 TS 是约定俗成的编号、
 * 对 JDT 是内部 ID，无法按形状分辨）；原始值由 {@link diagnosticCodeTooltip} 挂到
 * `title` 上兜底。若服务器同时声明了文档链接，链接本身保留，
 * 文案换成 source 名（无 source 时兜底 `docs`）—— 不丢"跳文档"的能力。
 */
export function diagnosticCodeBadge(diagnostic: LspDiagnostic): DiagnosticCodeBadge | null {
  const { code, codeDescription, source } = diagnostic;
  if (code == null) return null;

  const href = codeDescription?.href || undefined;
  if (!isNumericCode(code)) return { label: String(code), ...(href ? { href } : {}) };
  if (!href) return null;
  return { label: source || NUMERIC_CODE_LINK_LABEL, href };
}

/**
 * 行内不展示时把原始 code 塞进 `title`：悬停仍可查（TS 的 `2339` 能搜到，
 * JDT 的内部 ID 也不至于完全丢失）。已在行内展示的 code 无 tooltip。
 */
export function diagnosticCodeTooltip(diagnostic: LspDiagnostic): string | undefined {
  const { code } = diagnostic;
  if (code == null || !isNumericCode(code)) return undefined;
  return `Code: ${String(code)}`;
}

function isNumericCode(code: string | number): boolean {
  return typeof code === 'number' || NUMERIC.test(code);
}
