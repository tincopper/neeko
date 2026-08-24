/**
 * messageContent.ts — 消息文本的轻量 Markdown 解析（纯函数，无 React 依赖）。
 *
 * 覆盖 agent 正文回复中的常用结构：
 * - 围栏代码块 ` ```lang ... ``` ` → `code` 块
 * - 连续 `- ` 行 → `list` 块
 * - 其余按空行分段的 `text` 块（段内行内标记由 MessageContent 渲染层处理）
 *
 * 与 MessageContent 组件解耦：解析可独立测试、被 useMemo 缓存，
 * 且供流式渲染（text delta 追加后重新解析）复用。
 */

export type ParsedBlock =
  | { type: 'text'; text: string }
  | { type: 'code'; lang?: string; code: string }
  | { type: 'list'; items: string[] };

const FENCE_RE = /^```([\w+-]*)\s*$/;

/**
 * 把整段消息文本解析为块序列（按出现顺序）。
 * - 围栏代码块：``` 起止行之间为 code（lang 取 ``` 后的标识，空内容围栏产出空 code）
 * - 连续 `- ` 行聚合为 list（`- ` 前缀剥离）
 * - 其余聚合为 text，内部保留空行分段（渲染层按 \n\n 拆 <p>）
 */
export function parseMessageBlocks(text: string): ParsedBlock[] {
  const lines = text.split('\n');
  const blocks: ParsedBlock[] = [];

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    // 围栏代码块
    const fence = line.match(FENCE_RE);
    if (fence) {
      const lang = fence[1] || undefined;
      const codeLines: string[] = [];
      i += 1;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) {
        codeLines.push(lines[i]);
        i += 1;
      }
      i += 1; // 跳过闭合围栏
      blocks.push({ type: 'code', lang, code: codeLines.join('\n') });
      continue;
    }

    // 连续列表行
    if (/^-\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^-\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^-\s+/, ''));
        i += 1;
      }
      blocks.push({ type: 'list', items });
      continue;
    }

    // 普通文本：累积到下一个围栏 / 列表 / 空行块
    const textLines: string[] = [];
    while (i < lines.length && !/^```/.test(lines[i]) && !/^-\s+/.test(lines[i])) {
      textLines.push(lines[i]);
      i += 1;
    }
    blocks.push({ type: 'text', text: textLines.join('\n') });
  }

  return blocks;
}

/**
 * 为文本追加段落分隔（若尚未以空行结尾）。
 * 用于「文本 → 工具命令」衔接：命令前说明文本以 `\n\n` 收尾，
 * 避免正文文本与命令块在视觉上糅合。
 */
export function withParagraphBreak(text: string): string {
  if (text.endsWith('\n\n')) return text;
  return `${text}\n\n`;
}
