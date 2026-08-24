import type { ReactNode } from 'react';

import { resolveAgentIconSrc } from '@/features/agent/api/agentApi';
import {
  Terminal,
  FileText,
  FileDiff,
  Globe,
  MessageSquareText,
  GitPullRequest,
  Bot,
} from '@/shared/components/icons';
import type { AgentConfig } from '@/shared/types';
import type { Tab } from '@/shared/types/tab';
import { fileIconSrc } from '@/shared/utils/fileIcons';

/** 根据 tab kind 返回对应图标 */
function getTabIcon(kind: Tab['data']['kind']) {
  switch (kind) {
    case 'terminal':
      return Terminal;
    case 'file':
      return FileText;
    case 'diff':
      return FileDiff;
    case 'html-preview':
      return Globe;
    case 'conversation':
      return MessageSquareText;
    case 'prDetail':
      return GitPullRequest;
    case 'browser':
      return Globe;
    case 'agent-chat':
      return Bot;
  }
}

/**
 * Render the leading icon + status dots for an editor Tab (the area before the
 * title). Extracted from TabItem so the generic TabItem stays free of editor
 * specifics; dock panels inject their own simpler renderLeading.
 */
export function renderEditorTabLeading(tab: Tab, agents: AgentConfig[]): ReactNode {
  const Icon = getTabIcon(tab.data.kind);
  const data = tab.data;

  const agentIconSrc =
    data.kind === 'terminal' && data.agentId
      ? resolveAgentIconSrc(agents.find((a) => a.id === data.agentId)?.icon)
      : null;
  const fileIcon = data.kind === 'file' ? fileIconSrc(data.fileName) : null;
  const browserFavicon = data.kind === 'browser' ? data.favicon : null;

  const terminalStatus = data.kind === 'terminal' ? data.status : null;
  const showStatusDot = terminalStatus === 'Running' || terminalStatus === 'Failed';
  const statusDotColor = terminalStatus === 'Running' ? 'bg-accent-green' : 'bg-status-failed';
  const showDirtyDot = data.kind === 'file' && data.isDirty;

  return (
    <>
      {browserFavicon ? (
        <img
          data-testid="browser-favicon"
          src={browserFavicon}
          width={12}
          height={12}
          className="shrink-0 opacity-70"
          alt=""
        />
      ) : agentIconSrc ? (
        <img
          data-testid="agent-icon"
          src={agentIconSrc}
          width={12}
          height={12}
          className="shrink-0 opacity-70"
          alt=""
        />
      ) : fileIcon ? (
        <img src={fileIcon} width={12} height={12} className="shrink-0 opacity-70" alt="" />
      ) : (
        <Icon
          size={12}
          className="shrink-0 opacity-70"
          style={{ fontSize: 'var(--terminal-font-size)' }}
        />
      )}

      {showStatusDot && <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${statusDotColor}`} />}
      {showDirtyDot && <span className="w-1.5 h-1.5 rounded-full bg-accent shrink-0" />}
    </>
  );
}
