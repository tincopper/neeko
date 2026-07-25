export type EditorAction = 'explain' | 'review' | 'fix' | 'ask';

export interface CodeContext {
  filePath: string;
  startLine: number;
  endLine: number;
  language?: string;
}

export interface DiffContext {
  filePath: string;
  lineCount?: number;
  isFullDiff?: boolean;
  /** Combined multi-file diff context. */
  combined?: boolean;
  fileCount?: number;
  /** Distinct files involved in a selection (combined mode). */
  filePaths?: string[];
}

export function buildCodeMessage(
  action: EditorAction,
  ctx: CodeContext,
  question?: string,
): string {
  const lang = ctx.language || ctx.filePath.split('.').pop() || '';
  const location = `${ctx.filePath}:${ctx.startLine}-${ctx.endLine}`;

  switch (action) {
    case 'explain':
      return `explain the ${lang} code at ${location}`;
    case 'review':
      return `review this ${lang} code for issues at ${location}`;
    case 'fix':
      return `fix any bugs or issues in this ${lang} code at ${location}`;
    case 'ask':
      return `${question || '?'} (context: ${location})`;
  }
}

export function buildDiffMessage(
  action: EditorAction,
  ctx: DiffContext,
  question?: string,
): string {
  const filePath = ctx.filePath;
  const isCombined = !!ctx.combined;
  const fileCount = ctx.fileCount ?? ctx.filePaths?.length ?? 0;
  const selectedFiles = ctx.filePaths ?? [];
  const selectedFilesLabel =
    selectedFiles.length === 0
      ? ''
      : selectedFiles.length === 1
        ? selectedFiles[0]
        : selectedFiles.length <= 3
          ? selectedFiles.join(', ')
          : `${selectedFiles.slice(0, 3).join(', ')} (+${selectedFiles.length - 3} more)`;

  switch (action) {
    case 'review':
      if (ctx.isFullDiff) {
        if (isCombined) {
          return `review this commit diff across ${fileCount || 'multiple'} files`;
        }
        return `review the changes in ${filePath}`;
      }
      if (isCombined) {
        const filesPart = selectedFilesLabel || `${fileCount || 'multiple'} files`;
        return `review the selected changes across ${filesPart} (${ctx.lineCount ?? 0} lines)`;
      }
      return `review the selected changes in ${filePath} (${ctx.lineCount} lines)`;
    case 'explain':
      if (ctx.isFullDiff) {
        if (isCombined) {
          return `explain this commit diff across ${fileCount || 'multiple'} files`;
        }
        return `explain the changes in ${filePath}`;
      }
      if (isCombined) {
        const filesPart = selectedFilesLabel || `${fileCount || 'multiple'} files`;
        return `explain the selected changes across ${filesPart}`;
      }
      return `explain the selected changes in ${filePath}`;
    case 'fix':
      if (isCombined) {
        return `fix any issues in this commit diff${fileCount ? ` (${fileCount} files)` : ''}`;
      }
      return `fix any issues in the changes to ${filePath}`;
    case 'ask': {
      if (isCombined) {
        const filesPart =
          selectedFilesLabel || (fileCount ? `${fileCount} files` : 'combined diff');
        return `${question || '?'} (context: ${filesPart} diff${ctx.lineCount ? `, ${ctx.lineCount} lines` : ''})`;
      }
      return `${question || '?'} (context: ${filePath} diff${ctx.lineCount ? `, ${ctx.lineCount} lines` : ''})`;
    }
  }
}
