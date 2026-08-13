import type { DiffHunk } from './types';

/** 单次 review 消息中 diff 文本的最大字符数（超出截断并追加提示）。 */
export const DIFF_TEXT_MAX_CHARS = 200_000;

/**
 * 限制 diff 文本体积：超出上限时保留头部并追加截断提示。
 * 用于 AI review 消息组装，防止超大提交的完整 hunks 写成 MB 级 PTY 消息。
 */
export function capDiffText(text: string, maxChars: number = DIFF_TEXT_MAX_CHARS): string {
  if (text.length <= maxChars) return text;
  const omitted = text.length - maxChars;
  return `${text.slice(0, maxChars)}\n\n… [diff truncated: ${omitted} chars omitted]`;
}

/**
 * 把渲染同源的 hunks 转成带 new-side 行号前缀的 diff 文本，供 AI review 消息使用。
 *
 * 行号前缀与 DiffTable/SplitDiffTable 渲染的 new-side 行号一致：
 * - Added / Context 各占一行 new-side 行号（从 hunk.new_start 递增）
 * - Removed 不占 new-side 行号，用 `-` 占位
 * - Collapsed 不占行号，用省略号占位
 */
export function hunksToDiffText(hunks: DiffHunk[]): string {
  const out: string[] = [];
  for (const hunk of hunks) {
    out.push(`@@ -${hunk.old_start},${hunk.old_lines} +${hunk.new_start},${hunk.new_lines} @@`);
    let newLine = hunk.new_start;
    for (const line of hunk.lines) {
      if (line.Added !== undefined) {
        out.push(`  ${newLine}| ${line.Added}`);
        newLine += 1;
      } else if (line.Context !== undefined) {
        out.push(`  ${newLine}| ${line.Context}`);
        newLine += 1;
      } else if (line.Removed !== undefined) {
        out.push(`   -| ${line.Removed}`);
      } else {
        out.push('  …');
      }
    }
  }
  return out.join('\n');
}

/**
 * 把选中行转成带 old|new 行号前缀的文本，供 AI review 选区消息使用。
 *
 * 行号递增逻辑与 DiffTable 渲染一致：old 行号在非 added 行递增，new 行号在非
 * removed 行递增；Added 行 old 侧与 Removed 行 new 侧用 `-` 占位，Collapsed 输出
 * 省略号。仅输出 selectedKeys（`hunkIdx:lineIdx`）命中的行，不输出 hunk header。
 */
export function hunksToSelectedDiffText(hunks: DiffHunk[], selectedKeys: Set<string>): string {
  const out: string[] = [];
  hunks.forEach((hunk, hunkIdx) => {
    let oldNum = hunk.old_start;
    let newNum = hunk.new_start;
    hunk.lines.forEach((line, lineIdx) => {
      const curOld = oldNum;
      const curNew = newNum;
      if (line.Added !== undefined) {
        if (selectedKeys.has(`${hunkIdx}:${lineIdx}`)) out.push(`-|${curNew}| ${line.Added}`);
        newNum += 1;
      } else if (line.Context !== undefined) {
        if (selectedKeys.has(`${hunkIdx}:${lineIdx}`))
          out.push(`${curOld}|${curNew}| ${line.Context}`);
        oldNum += 1;
        newNum += 1;
      } else if (line.Removed !== undefined) {
        if (selectedKeys.has(`${hunkIdx}:${lineIdx}`)) out.push(`${curOld}|-| ${line.Removed}`);
        oldNum += 1;
      } else if (selectedKeys.has(`${hunkIdx}:${lineIdx}`)) {
        out.push('…');
      }
    });
  });
  return out.join('\n');
}
