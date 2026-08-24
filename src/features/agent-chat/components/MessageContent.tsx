import { memo, useMemo, type ReactNode } from 'react';

import { parseMessageBlocks } from '../utils/messageContent';

interface MessageContentProps {
  /** 消息文本（含轻量 markdown：围栏代码块 / `行内 code` / **加粗** / - 列表）。 */
  text: string;
  /** 本话轮已展示过的工具输出。正文代码块若与任一输出重复则不重复渲染。 */
  toolOutputs?: string[];
}

/**
 * 把行内标记（`code` / **bold**）拆分为 React 节点序列。
 * 反引号 code 优先于加粗匹配。
 */
function renderInline(text: string): ReactNode[] {
  const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
      return <code key={i}>{part.slice(1, -1)}</code>;
    }
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
      return <strong key={i}>{part.slice(2, -2)}</strong>;
    }
    return part;
  });
}

/**
 * 正文代码块与工具输出重复判定：代码块是某一输出的起始段子集
 * （截断场景，如 `ls` 输出后跟 `...`），或输出是代码块的一部分。
 */
function isDuplicateOutput(code: string, outputs: string[]): boolean {
  const codeLines = code.split('\n').filter((l) => l.trim() !== '');
  if (codeLines.length === 0) return false;
  const trimmed = code.trim();

  for (const out of outputs) {
    const outLines = out.split('\n').filter((l) => l.trim() !== '');
    if (outLines.length === 0) continue;
    // 代码块以空行截断 → 整块是输出的子串
    if (out.includes(trimmed) && trimmed.length >= 8) return true;
    // 输出以空行截断 → 输出是代码块子串
    if (trimmed.includes(out.trim()) && out.trim().length >= 8) return true;
    // 起始段按行匹配（截断场景：代码块末尾是 ...）
    let match = 0;
    const bound = Math.min(codeLines.length, outLines.length);
    for (let i = 0; i < bound; i++) {
      if (codeLines[i].trim() === outLines[i].trim()) {
        match += 1;
      } else {
        break;
      }
    }
    // 至少 2 行或几乎全部（≤1 行差异）匹配视为重复
    if (match >= Math.max(2, Math.min(codeLines.length, outLines.length) - 1)) return true;
  }
  return false;
}

/**
 * 消息正文内容块 —— 轻量 markdown 渲染（纯段落 / 列表 / 代码块）。
 *
 * 设计要点：
 * - `React.memo` + `useMemo`：text 不变时不重复解析（流式追加场景下
 *   每帧 flush 都会携带新 text，memo 保证未变化的既有消息不重解析）。
 * - 正文代码块与工具输出（CommandCard 已展示）重复时跳过，避免同一份
 *   输出在消息流里出现两次。
 */
function MessageContent({ text, toolOutputs }: MessageContentProps) {
  const blocks = useMemo(() => parseMessageBlocks(text), [text]);

  if (!text || blocks.length === 0) return null;

  return (
    <div className="rich">
      {blocks.map((block, i) => {
        if (block.type === 'code') {
          const code = block.code;
          const skip =
            toolOutputs && toolOutputs.length > 0 && isDuplicateOutput(code, toolOutputs);
          if (skip || code.trim() === '') return null;
          return (
            <div className="codeblock" key={i}>
              {block.lang && <div className="cb-head">{block.lang}</div>}
              <pre>
                <code>{code}</code>
              </pre>
            </div>
          );
        }
        if (block.type === 'list') {
          return (
            <ul key={i}>
              {block.items.map((item, j) => (
                <li key={j}>{renderInline(item)}</li>
              ))}
            </ul>
          );
        }
        // text：按空行分段
        return block.text
          .split(/\n{2,}/)
          .filter((seg) => seg.trim() !== '')
          .map((seg, j) => <p key={`${i}-${j}`}>{renderInline(seg)}</p>);
      })}
    </div>
  );
}

export default memo(MessageContent);
