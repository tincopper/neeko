import type { DiffHunk, DiffLine, DiffResult, FileLineChange } from '@/shared/types/git';

/**
 * 从 `get_file_diff` 结果推导编辑器行级变更（方案 A：零后端）。
 *
 * 语义契约（与 DiffTable/buildSplitRows 行号规则对齐）：
 * - new 侧行号从 `hunk.new_start` 起：Context/Added 占 1 行，Removed 不占；
 * - `Collapsed("N unmodified lines")` 按 N 推进 new 行号（隐藏行仍存在于文档）；
 * - 同 hunk 内连续 Removed 块后紧跟 Added 块 → 索引配对：双方都在 = modified，
 *   Added 多出 = added，Removed 多出不产条目；
 * - 孤立 Added 块 = added；纯 Removed / 仅 Context = 无条目；
 * - 输出按 line 升序、同行去重（后者覆盖）；truncated 时返回已得部分。
 *
 * 纯函数，无 IPC；拉取 + 推导的 IPC  seam 在 `../api/fileLineChange`。
 */
export function deriveFileLineChanges(diff: DiffResult): FileLineChange[] {
  const byLine = new Map<number, FileLineChange>();
  for (const hunk of diff.hunks ?? []) {
    collectHunk(hunk, byLine);
  }
  return [...byLine.values()].sort((a, b) => a.line - b.line);
}

function collectHunk(hunk: DiffHunk, out: Map<number, FileLineChange>): void {
  let newLine = hunk.new_start;
  const lines = hunk.lines ?? [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (isContext(line)) {
      newLine += 1;
      i += 1;
      continue;
    }
    if (isCollapsed(line)) {
      newLine += parseCollapsedCount(line.Collapsed);
      i += 1;
      continue;
    }
    if (isRemoved(line)) {
      let removedCount = 0;
      while (i < lines.length && isRemoved(lines[i])) {
        removedCount += 1;
        i += 1;
      }
      let addedCount = 0;
      while (i < lines.length && isAdded(lines[i])) {
        addedCount += 1;
        i += 1;
      }
      const paired = Math.min(removedCount, addedCount);
      for (let j = 0; j < paired; j++) {
        out.set(newLine, { line: newLine, kind: 'modified' });
        newLine += 1;
      }
      for (let j = paired; j < addedCount; j++) {
        out.set(newLine, { line: newLine, kind: 'added' });
        newLine += 1;
      }
      // removed 多出的行：编辑器无行位，丢弃
      continue;
    }
    if (isAdded(line)) {
      out.set(newLine, { line: newLine, kind: 'added' });
      newLine += 1;
      i += 1;
      continue;
    }
    // 未知行类型：跳过不推进（防御）
    i += 1;
  }
}

function isContext(line: DiffLine): line is { Context: string } {
  return 'Context' in line;
}

function isAdded(line: DiffLine): line is { Added: string } {
  return 'Added' in line;
}

function isRemoved(line: DiffLine): line is { Removed: string } {
  return 'Removed' in line;
}

function isCollapsed(line: DiffLine): line is { Collapsed: string } {
  return 'Collapsed' in line;
}

/**
 * 解析 `N unmodified lines` 折叠占位文本中的行数。
 * 与 components/diff 的 `diffCollapsedSections.parseCollapsedCount` 同语义的**刻意副本** ——
 * 本模块（utils 层）不上探 components 内部实现（层级方向），两者独立演进。
 */
function parseCollapsedCount(text: string): number {
  const m = text.match(/^(\d+)\s+unmodified lines?$/);
  return m ? Number(m[1]) : 0;
}
