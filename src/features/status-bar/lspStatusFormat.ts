/** LSP 状态栏的纯展示逻辑：常量 + 状态聚合 / 文案格式化。
 *
 * 无 React / 无 store 依赖，可直接单测（见 `lspStatusFormat.test.ts`）。
 */

import type { LspServerInfo } from '@/features/lsp/api/lspApi';
import type { LspSessionState } from '@/features/lsp/store/lspStore';

export const EASE_OUT = 'cubic-bezier(0.16, 1, 0.3, 1)';
export const EASE_IN = 'cubic-bezier(0.7, 0, 0.84, 0)';
export const ENTER_DUR = 120;
export const EXIT_DUR = 80;

const BUILTIN_SERVER_NAMES: Record<string, string> = {
  rust: 'rust-analyzer',
  python: 'pyright',
  typescript: 'typescript-language-server',
  javascript: 'typescript-language-server',
  go: 'gopls',
  java: 'jdtls',
  cpp: 'clangd',
  csharp: 'omnisharp',
};

/** Prefer live session/profile server name so custom LSPs display correctly. */
export function serverName(languageId: string, liveName?: string | null): string {
  if (liveName && liveName.trim()) return liveName;
  return BUILTIN_SERVER_NAMES[languageId] ?? languageId;
}

export function statusDotClass(
  status:
    | LspSessionState['status']
    | 'aggregate-error'
    | 'aggregate-busy'
    | 'aggregate-ready'
    | 'muted',
): string {
  switch (status) {
    case 'ready':
    case 'aggregate-ready':
      return 'bg-status-idle';
    case 'error':
    case 'aggregate-error':
      return 'bg-status-failed';
    case 'stopped':
    case 'muted':
      return 'bg-text-muted';
    default:
      // starting | initializing | indexing | aggregate-busy
      return 'bg-status-running animate-pulse';
  }
}

export function aggregateStatus(
  sessions: LspSessionState[],
): 'aggregate-error' | 'aggregate-busy' | 'aggregate-ready' {
  if (sessions.some((s) => s.status === 'error')) return 'aggregate-error';
  if (
    sessions.some(
      (s) => s.status === 'indexing' || s.status === 'starting' || s.status === 'initializing',
    )
  ) {
    return 'aggregate-busy';
  }
  return 'aggregate-ready';
}

export function humanStatus(status: LspSessionState['status']): string {
  switch (status) {
    case 'ready':
      return 'Running';
    case 'starting':
      return 'Starting';
    case 'initializing':
      return 'Initializing';
    case 'indexing':
      return 'Indexing';
    case 'error':
      return 'Error';
    case 'stopped':
      return 'Stopped';
    default:
      return status;
  }
}

function formatMemoryMb(mb: number): string {
  if (!Number.isFinite(mb) || mb <= 0) return '—';
  if (mb >= 100) return `${Math.round(mb)} MB`;
  return `${mb.toFixed(1)} MB`;
}

export function formatInfoFooter(
  status: LspSessionState['status'],
  info: LspServerInfo | null,
): string {
  const statusLabel = humanStatus(status);
  if (!info) return statusLabel;
  const version = info.version ? `v${info.version}` : 'v?';
  const metaParts: string[] = [];
  if (info.commit) metaParts.push(info.commit);
  if (info.buildDate) metaParts.push(info.buildDate);
  const meta = metaParts.length > 0 ? ` (${metaParts.join(' ')})` : '';
  const mem = formatMemoryMb(info.memoryMb);
  return `${statusLabel} — ${version}${meta} — ${mem}`;
}
