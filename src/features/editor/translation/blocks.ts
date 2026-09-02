import type { ListItem, PhrasingContent, Root, RootContent } from 'mdast';
import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import { unified } from 'unified';

/** 可翻译的文档块类型 */
export type DocBlockKind = 'heading' | 'paragraph' | 'list-item' | 'quote' | 'table-cell';

/**
 * 切分出的原文块。id 为文档序稳定 id（`b{n}`），用于流式回填与单段重试定位；
 * 渲染层以同一遍历顺序对齐块与文档元素。
 */
export interface SourceBlock {
  id: string;
  kind: DocBlockKind;
  /** 标题层级 1-6，仅 heading */
  level?: number;
  /** 送翻译的原文（md 保留行内标记；html/txt 为纯文本） */
  text: string;
}

const parser = unified().use(remarkParse).use(remarkGfm);

// ── Markdown ────────────────────────────────────────────────────────────

/**
 * Markdown → 可翻译块。
 * 规则：heading / paragraph / list-item（嵌套拍平）/ quote（引用内段落）/ table-cell
 * 逐块输出；代码块、分隔线、内嵌 HTML 等不可译节点跳过。
 */
export function splitMarkdownBlocks(source: string): SourceBlock[] {
  const tree = parser.parse(source) as Root;
  const blocks: SourceBlock[] = [];
  for (const node of tree.children) {
    walkMarkdownNode(node, blocks, undefined);
  }
  return blocks;
}

function walkMarkdownNode(node: RootContent, out: SourceBlock[], container?: DocBlockKind): void {
  switch (node.type) {
    case 'heading':
      pushBlock(out, 'heading', inlineToMarkdown(node.children), node.depth);
      break;
    case 'paragraph':
      pushBlock(out, container ?? 'paragraph', inlineToMarkdown(node.children));
      break;
    case 'list':
      for (const item of node.children) {
        walkMarkdownListItem(item, out);
      }
      break;
    case 'blockquote':
      for (const child of node.children) {
        walkMarkdownNode(child, out, 'quote');
      }
      break;
    case 'table':
      for (const row of node.children) {
        for (const cell of row.children) {
          pushBlock(out, 'table-cell', inlineToMarkdown(cell.children));
        }
      }
      break;
    default:
      // code / thematicBreak / html / 其他不可译节点
      break;
  }
}

function walkMarkdownListItem(item: ListItem, out: SourceBlock[]): void {
  for (const child of item.children) {
    walkMarkdownNode(child, out, 'list-item');
  }
}

function pushBlock(out: SourceBlock[], kind: DocBlockKind, text: string, level?: number): void {
  const trimmed = text.trim();
  if (!trimmed) return;
  out.push({
    id: `b${out.length}`,
    kind,
    ...(kind === 'heading' && level ? { level } : {}),
    text: trimmed,
  });
}

/** 行内 mdast → 保留行内标记的 markdown 文本（粗体/斜体/行内代码/链接/删除线/图片） */
function inlineToMarkdown(nodes: PhrasingContent[]): string {
  return nodes.map(serializeInline).join('');
}

function serializeInline(node: PhrasingContent): string {
  switch (node.type) {
    case 'text':
      return node.value;
    case 'strong':
      return `**${inlineToMarkdown(node.children)}**`;
    case 'emphasis':
      return `*${inlineToMarkdown(node.children)}*`;
    case 'inlineCode':
      return `\`${node.value}\``;
    case 'delete':
      return `~~${inlineToMarkdown(node.children)}~~`;
    case 'link':
      return `[${inlineToMarkdown(node.children)}](${node.url})`;
    case 'image':
      return `![${node.alt ?? ''}](${node.url})`;
    case 'break':
      return '\n';
    case 'html':
      return node.value;
    default:
      return 'value' in node ? String((node as { value?: unknown }).value ?? '') : '';
  }
}

// ── HTML ────────────────────────────────────────────────────────────────

const SKIP_HTML_TAGS = new Set(['SCRIPT', 'STYLE', 'PRE', 'CODE', 'TEMPLATE']);
const LIST_TAGS = new Set(['UL', 'OL']);
/** 通用容器：递归进入而非当作内联文本收割（否则其内 SKIP 元素文本会漏入） */
const GENERIC_HTML_TAGS = new Set([
  'DIV',
  'SECTION',
  'ARTICLE',
  'MAIN',
  'ASIDE',
  'NAV',
  'HEADER',
  'FOOTER',
  'FIGURE',
  'FIGCAPTION',
  'DETAILS',
  'SUMMARY',
  'DL',
  'DT',
  'DD',
  'CENTER',
]);
const HEADING_LEVELS: Record<string, number> = {
  H1: 1,
  H2: 2,
  H3: 3,
  H4: 4,
  H5: 5,
  H6: 6,
};

/** HTML 文本统一折叠空白（换行/缩进对译文无意义） */
function collapseText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * HTML → 可翻译块。DOMParser 提取块级可见文本（标题/段落/列表项/单元格/引用），
 * script/style/pre/code 跳过，空白折叠、实体由解析器解码。
 */
export function splitHtmlBlocks(source: string): SourceBlock[] {
  if (!source.trim()) return [];
  const doc = new DOMParser().parseFromString(source, 'text/html');
  const blocks: SourceBlock[] = [];
  walkHtmlElement(doc.body, blocks, undefined);
  return blocks;
}

function walkHtmlElement(el: Element, out: SourceBlock[], container?: DocBlockKind): void {
  if (SKIP_HTML_TAGS.has(el.tagName)) return;

  const headingLevel = HEADING_LEVELS[el.tagName];
  if (headingLevel) {
    pushBlock(out, 'heading', collapseText(el.textContent ?? ''), headingLevel);
    return;
  }
  if (el.tagName === 'P') {
    pushBlock(out, container ?? 'paragraph', collapseText(el.textContent ?? ''));
    return;
  }
  if (LIST_TAGS.has(el.tagName)) {
    for (const child of Array.from(el.children)) {
      if (child.tagName === 'LI') walkHtmlListItem(child, out);
    }
    return;
  }
  if (el.tagName === 'BLOCKQUOTE') {
    for (const child of Array.from(el.children)) {
      walkHtmlElement(child, out, 'quote');
    }
    return;
  }
  if (el.tagName === 'TABLE') {
    for (const cell of el.querySelectorAll('td, th')) {
      pushBlock(out, 'table-cell', collapseText(cell.textContent ?? ''));
    }
    return;
  }

  // 通用容器（div/section/article/body…）：收集松散文本，块级子元素递归
  let looseText = '';
  const flush = () => {
    pushBlock(out, container ?? 'paragraph', collapseText(looseText));
    looseText = '';
  };
  for (const child of Array.from(el.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE) {
      looseText += child.textContent ?? '';
    } else if (child.nodeType === Node.ELEMENT_NODE) {
      const childEl = child as Element;
      if (SKIP_HTML_TAGS.has(childEl.tagName)) {
        flush();
      } else if (isBlockElement(childEl) || GENERIC_HTML_TAGS.has(childEl.tagName)) {
        flush();
        walkHtmlElement(childEl, out, container);
      } else {
        looseText += childEl.textContent ?? '';
      }
    }
  }
  flush();
}

function walkHtmlListItem(li: Element, out: SourceBlock[]): void {
  // li 自身文本（不含嵌套列表）成为一个块，嵌套列表递归拍平
  let ownText = '';
  const flush = () => {
    pushBlock(out, 'list-item', collapseText(ownText));
    ownText = '';
  };
  for (const child of Array.from(li.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE) {
      ownText += child.textContent ?? '';
    } else if (child.nodeType === Node.ELEMENT_NODE) {
      const childEl = child as Element;
      if (LIST_TAGS.has(childEl.tagName)) {
        flush();
        walkHtmlElement(childEl, out, 'list-item');
      } else if (SKIP_HTML_TAGS.has(childEl.tagName)) {
        // skip
      } else if (isBlockElement(childEl) || GENERIC_HTML_TAGS.has(childEl.tagName)) {
        flush();
        walkHtmlElement(childEl, out, 'list-item');
      } else {
        ownText += childEl.textContent ?? '';
      }
    }
  }
  flush();
}

function isBlockElement(el: Element): boolean {
  return (
    HEADING_LEVELS[el.tagName] !== undefined ||
    el.tagName === 'P' ||
    LIST_TAGS.has(el.tagName) ||
    el.tagName === 'BLOCKQUOTE' ||
    el.tagName === 'TABLE'
  );
}

// ── 纯文本 ──────────────────────────────────────────────────────────────

/** 纯文本按空行分段（单个换行保留在段内），空白段丢弃 */
export function splitTextBlocks(source: string): SourceBlock[] {
  const blocks: SourceBlock[] = [];
  for (const segment of source.split(/\n[ \t]*\n/)) {
    const text = segment.replace(/^\n+|\n+$/g, '').trim();
    if (!text) continue;
    blocks.push({ id: `b${blocks.length}`, kind: 'paragraph', text });
  }
  return blocks;
}
