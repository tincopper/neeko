import type { ReactNode } from 'react';

import { AgentIcon } from '@/features/agent';
import AgentChatIcon from '@/shared/components/AgentChatIcon';
import {
  Terminal,
  FileText,
  FileDiff,
  Globe,
  MessageSquareText,
  GitPullRequest,
  Bot,
} from '@/shared/components/icons';
import SessionStatusIcon from '@/shared/components/SessionStatusIcon';
import type { AgentConfig } from '@/shared/types';
import type { SessionView } from '@/shared/types/liveSessions';
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
      // 专用品牌图标（img 分支优先渲染）；Bot 仅作类型完整性兜底，正常不显示。
      return Bot;
  }
}

/**
 * Render the leading icon + status dot for an editor Tab (the area before the
 * title). Extracted from TabItem so the generic TabItem stays free of editor
 * specifics; dock panels inject their own simpler renderLeading.
 *
 * `session` 是注册表快照里该 tab 对应的那一条：状态点只能来自它 —— 视图不再持有
 * 状态副本（`TerminalTabData.status` 已删除：写一次、无人读，图标因此「固定」）。
 */
export function renderEditorTabLeading(
  tab: Tab,
  agents: AgentConfig[],
  session?: SessionView | null,
): ReactNode {
  const Icon = getTabIcon(tab.data.kind);
  const data = tab.data;

  const agentIconName =
    data.kind === 'terminal' && data.agentId
      ? (agents.find((a) => a.id === data.agentId)?.icon ?? null)
      : null;
  const fileIcon = data.kind === 'file' ? fileIconSrc(data.fileName) : null;
  const browserFavicon = data.kind === 'browser' ? data.favicon : null;

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
      ) : data.kind === 'agent-chat' ? (
        <AgentChatIcon size={12} className="shrink-0 opacity-70" />
      ) : agentIconName ? (
        <AgentIcon
          icon={agentIconName}
          size={12}
          className="shrink-0 opacity-70"
          testId="agent-icon"
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

      {/* 状态点：与侧栏会话行 / 单元角标同源（`SessionStatusIcon` 是状态→视觉的唯一表） */}
      <SessionStatusIcon status={session?.state ?? null} size={6} />
      {showDirtyDot && <span className="w-1.5 h-1.5 rounded-full bg-accent shrink-0" />}
    </>
  );
}
