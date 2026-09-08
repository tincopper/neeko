/**
 * 剥 ANSI 转义序列（调试台 console / 命令输出显示前用）。
 *
 * codelldb / libtest 输出带颜色（`\x1b[32m`…`\x1b[0m`）、字符集选择（`\x1b(B`）、
 * OSC 超链接（`\x1b]8;;…\x1b\`）等；纯文本面板原样显示即乱码。
 * 覆盖：CSI（`ESC [ … letter`）、字符集（`ESC ( letter`）、OSC（`ESC ] … ESC \`/BEL）、
 * 单字符控制（`ESC letter`）。
 */

/** `\x1b` 控制字符（避免正则字面量触发 no-control-regex）。 */
const ESC = String.fromCharCode(0x1b);

/**
 * 组装正则。`\\[`/`\\(`/`\\]` 在模板里生成转义正则（字面 `[`/`(`/`]`）：
 * - CSI:   ESC + `[` + 参数 + letter
 * - charset: ESC + `(` + letter
 * - OSC:   ESC + `]` + 内容 + (ESC+`\` 或 BEL)
 * - single: ESC + letter
 */
const PATTERN_SRC = [
  `${ESC}\\[[0-9;?]*[A-Za-z]`,
  `${ESC}\\([A-Za-z]`,
  `${ESC}\\].*?(?:${ESC}\\\\|\\x07)`,
  `${ESC}[A-Za-z]`,
].join('|');

const ANSI_PATTERN = new RegExp(PATTERN_SRC, 'g');

/** 剥除文本中的 ANSI 转义序列，返回纯文本。 */
export function stripAnsi(text: string): string {
  return text.replace(ANSI_PATTERN, '');
}
