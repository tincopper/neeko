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

/** 状态栏 chip 上的展示决策：文案 + tooltip + 重试入口归属。 */
export interface ChipPresentation {
  label: string;
  title: string;
  /**
   * 非空即渲染重试按钮。仅**单会话 error 态**暴露——多会话时由下拉行内
   * 各语言自己的 Restart 承载（chip 上放重试会造成"重试哪一个"的歧义）。
   */
  retry: { languageId: string; label: string } | null;
}

const BUSY_CHIP_STATUS: Record<string, true> = {
  starting: true,
  initializing: true,
  indexing: true,
};

const MANAGE_HINT = 'Click to manage LSP servers';

/**
 * 把会话列表（已由调用方做 ready+tokens → indexing 投影）压成 chip 展示态。
 *
 * 第一性原理：chip 是**单会话摘要**，多会话时必须退化为计数——否则聚合圆点
 * 与单一服务器名会互相矛盾。崩溃态（error）是唯一需要在 chip 上直接暴露
 * 完整 message 的情形：用户要能自答"为什么没有提示"（M2 / AC2）。
 */
export function chipPresentation(entries: readonly LspSessionState[]): ChipPresentation {
  if (entries.length === 0) return { label: '', title: MANAGE_HINT, retry: null };

  if (entries.length > 1) {
    const label = `${entries.length} LSPs`;
    return { label, title: label, retry: null };
  }

  const { languageId, serverName: liveName, status, statusMessage } = entries[0];
  const name = serverName(languageId, liveName);

  if (status === 'error') {
    // message 缺失时降级为「名字 Error」——重试入口不得因缺文案而消失。
    const message = statusMessage || `${name} ${humanStatus(status)}`;
    return {
      label: message,
      title: `${message} (click to manage)`,
      retry: { languageId, label: `Restart ${name}` },
    };
  }

  const label = BUSY_CHIP_STATUS[status] ? `${name} ${humanStatus(status)}` : name;
  return { label, title: MANAGE_HINT, retry: null };
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
