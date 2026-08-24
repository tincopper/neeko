/**
 * diffHighlight.ts — unified diff 行分类纯函数。
 *
 * 用于审批弹窗（RequestApproval.diff）与 FileDiff 的按行高亮渲染。
 * 无 React / store 依赖，纯字符串分类。
 */

/** diff 行的种类。 */
export type DiffLineKind = 'add' | 'rem' | 'hunk' | 'ctx';

/**
 * 将一行 unified diff 分类：
 * - `@@ ... @@` → hunk（区块头）
 * - `+...`（非 `+++` 文件头）→ add（新增）
 * - `-...`（非 `---` 文件头）→ rem（删除）
 * - 其余（含 context、空行、`---`/`+++` 文件头）→ ctx
 */
export function classifyDiffLine(line: string): DiffLineKind {
  if (line.startsWith('@@')) return 'hunk';
  if (line.startsWith('+++') || line.startsWith('---')) return 'ctx';
  if (line.startsWith('+')) return 'add';
  if (line.startsWith('-')) return 'rem';
  return 'ctx';
}

/** 仅 diff 内容行（add/rem/hunk）需要高亮，文件头与 context 保持默认色。 */
export function isDiffLine(kind: DiffLineKind): boolean {
  return kind === 'add' || kind === 'rem' || kind === 'hunk';
}

/**
 * 判断整段输出是否为 unified diff（供输出区按内容分流渲染）。
 * 强信号：hunk 头 / `diff --git` / `--- a|b` 文件头；
 * 弱信号：无强信号时，`+`/`-` 后紧跟非空格的变更行占比 > 40% 视为 diff
 * （`- `/`+ ` 后跟空格的行是 markdown 列表项，不计为 diff 行，避免误判）。
 * 水平线 `---`（markdown，整行无后续路径）不计为文件头。
 */
export function isDiffOutput(output: string): boolean {
  const lines = output.split('\n');
  if (
    lines.some(
      (l) =>
        l.startsWith('@@') ||
        l.startsWith('diff --git') ||
        /^---\s+[ab]\//.test(l) ||
        /^\+\+\+\s+[ab]\//.test(l),
    )
  ) {
    return true;
  }
  const changed = lines.filter((l) => /^[+-](?!\s)/.test(l)).length;
  return changed / lines.length > 0.4;
}

/** 统计一份 unified diff 的新增/删除行数（文件头 `---`/`+++` 不计）。 */
export function diffStats(diff: string): { add: number; del: number } {
  let add = 0;
  let del = 0;
  for (const line of diff.split('\n')) {
    if (line.startsWith('+') && !line.startsWith('+++')) add += 1;
    else if (line.startsWith('-') && !line.startsWith('---')) del += 1;
  }
  return { add, del };
}
