/**
 * messageContent.ts — 消息文本处理工具（纯函数，无 React 依赖）。
 *
 * 消息正文的完整 markdown 渲染已迁移至 MessageContent（react-markdown），
 * 本模块仅保留流式渲染链路仍需要的文本衔接工具。
 */

/**
 * 为文本追加段落分隔（若尚未以空行结尾）。
 * 用于「文本 → 工具命令」衔接：命令前说明文本以 `\n\n` 收尾，
 * 避免正文文本与命令块在视觉上糅合。
 */
export function withParagraphBreak(text: string): string {
  if (text.endsWith('\n\n')) return text;
  return `${text}\n\n`;
}
