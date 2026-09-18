/** 下拉列表里的单个 LSP 服务器行：纯展示 + 一个 open 回调（无自身状态）。 */

import type { LspSessionState } from '@/features/lsp/store/lspStore';
import { cn } from '@/lib/utils';

import { serverName, statusDotClass } from './lspStatusFormat';
import { ChevronRight } from './LspStatusIcons';

interface Props {
  session: LspSessionState;
  isActive: boolean;
  onOpen: (languageId: string) => void;
  registerRef: (el: HTMLButtonElement | null) => void;
}

export function LspServerRow({ session, isActive, onOpen, registerRef }: Props) {
  const label = serverName(session.languageId, session.serverName);
  const title = `${session.status}${session.statusMessage ? `: ${session.statusMessage}` : ''}${
    session.progressPct != null ? ` (${session.progressPct}%)` : ''
  }`;
  return (
    <button
      ref={registerRef}
      type="button"
      className={cn(
        'w-full flex items-center justify-between px-3 py-1.5 hover:bg-bg-hover hover:rounded-sm cursor-pointer text-left transition-[background-color] duration-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent-blue',
        isActive && 'bg-bg-hover',
      )}
      title={title}
      onMouseEnter={() => onOpen(session.languageId)}
      onFocus={() => onOpen(session.languageId)}
      onClick={() => onOpen(session.languageId)}
      data-testid={`lsp-server-row-${session.languageId}`}
    >
      <span className="flex items-center gap-1.5 min-w-0">
        <span className={cn('w-1.5 h-1.5 rounded-full shrink-0', statusDotClass(session.status))} />
        <span className="truncate">{label}</span>
        {session.statusMessage && (
          <span
            className="text-text-muted truncate"
            data-testid={`lsp-row-msg-${session.languageId}`}
          >
            {session.statusMessage}
          </span>
        )}
        {session.progressPct != null && (
          <span className="text-text-muted shrink-0">{session.progressPct}%</span>
        )}
      </span>
      <ChevronRight />
    </button>
  );
}
