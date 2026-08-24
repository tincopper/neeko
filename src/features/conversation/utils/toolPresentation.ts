import { Edit, File, Search, Terminal } from 'lucide-react';

// 工具图标映射（唯一事实源，ConversationViewer 与 MessageBlocks 共用）
const TOOL_ICONS: Record<string, React.FC<{ className?: string }>> = {
  Read: File,
  Write: Edit,
  Edit: Edit,
  Bash: Terminal,
  Grep: Search,
  Glob: Search,
  GlobSearch: Search,
  LS: File,
  Cat: File,
};

export function getToolIcon(name: string): React.FC<{ className?: string }> {
  return TOOL_ICONS[name] ?? Terminal;
}

// 工具摘要提取
export function getToolSummary(name: string, input: unknown): string {
  if (!input || typeof input !== 'object') return '';
  const obj = input as Record<string, unknown>;

  switch (name) {
    case 'Read':
    case 'Write':
    case 'Edit':
    case 'LS':
    case 'Cat':
      return (obj.file_path ?? obj.path ?? '') as string;
    case 'Bash':
      return (obj.command ?? '') as string;
    case 'Grep':
    case 'Glob':
    case 'GlobSearch':
      return (obj.pattern ?? '') as string;
    default:
      return JSON.stringify(input).slice(0, 60);
  }
}
