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
}

export function buildCodeMessage(action: EditorAction, ctx: CodeContext, question?: string): string {
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

export function buildDiffMessage(action: EditorAction, ctx: DiffContext, question?: string): string {
  const filePath = ctx.filePath;

  switch (action) {
    case 'review':
      if (ctx.isFullDiff) {
        return `review the uncommitted changes in ${filePath}`;
      }
      return `review the selected changes in ${filePath} (${ctx.lineCount} lines)`;
    case 'explain':
      if (ctx.isFullDiff) {
        return `explain the changes in ${filePath}`;
      }
      return `explain the selected changes in ${filePath}`;
    case 'fix':
      return `fix any issues in the changes to ${filePath}`;
    case 'ask':
      return `${question || '?'} (context: ${filePath} diff${ctx.lineCount ? `, ${ctx.lineCount} lines` : ''})`;
  }
}
