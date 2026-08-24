import { Children, memo, type ReactElement, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import rehypeHighlight from 'rehype-highlight';
import remarkGfm from 'remark-gfm';

interface MessageContentProps {
  /** 消息文本（完整 markdown：标题/链接/表格/引用/列表/围栏代码块/行内 code/加粗）。 */
  text: string;
  /** 本话轮已展示过的工具输出。正文代码块若与任一输出重复则不重复渲染。 */
  toolOutputs?: string[];
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
 * 递归提取 ReactNode 的纯文本（语法高亮会把 code children 拆成
 * hljs span 元素数组，去重/空判需要纯文本，显示保留原节点）。
 */
function nodeToText(node: ReactNode): string {
  if (node == null || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(nodeToText).join('');
  if (typeof node === 'object' && 'props' in node) {
    return nodeToText((node as ReactElement).props?.children);
  }
  return '';
}

/**
 * 消息正文 —— 完整 markdown 渲染（react-markdown + GFM + 语法高亮）。
 *
 * 设计要点：
 * - `React.memo`：text 不变时不重复解析（流式追加场景下每帧 flush 都会
 *   携带新 text，memo 保证未变化的既有消息不重渲染）。
 * - 代码块与工具输出（CommandCard 等已展示）重复时跳过，避免同一份
 *   输出在消息流里出现两次。
 * - 不启用 rehype-raw：agent 文本按纯 markdown 解析，规避 raw HTML 注入。
 */
function MessageContent({ text, toolOutputs }: MessageContentProps) {
  if (!text) return null;

  return (
    <div className="rich">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={{
          // 代码块：去重 + codeblock 结构（cb-head 语言标签 / pre / code），保留语法高亮节点
          pre({ children }) {
            // react-markdown 恒产出单个 code 子节点；防御性取首个，避免 Children.only 抛异常
            const first = Children.toArray(children)[0];
            if (!first || typeof first !== 'object' || !('props' in first)) return null;
            const child = first as ReactElement<{
              children?: ReactNode;
              className?: string;
            }>;
            const codeText = nodeToText(child.props?.children).replace(/\n$/, '');
            const skip =
              toolOutputs && toolOutputs.length > 0 && isDuplicateOutput(codeText, toolOutputs);
            if (skip || codeText.trim() === '') return null;
            const lang = /language-(\w+)/.exec(String(child.props?.className ?? ''))?.[1];
            return (
              <div className="codeblock">
                {lang && <div className="cb-head">{lang}</div>}
                <pre>
                  <code className={child.props?.className}>{child.props?.children}</code>
                </pre>
              </div>
            );
          },
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}

export default memo(MessageContent);
