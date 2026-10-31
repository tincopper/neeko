import React, { useMemo } from 'react';

import SessionList from '@/shared/components/SessionList';
import { useSessionsByUnit } from '@/shared/hooks/useSessionsByUnit';
import { NO_SESSIONS, tabSession } from '@/shared/selectors/liveSessionSelectors';
import { useEditorStore } from '@/shared/store/editorStore';
import { selectActiveTabId } from '@/shared/store/editorTabSelectors';

import { useActivateSession } from '../hooks/useActivateSession';

interface UnitSessionListProps {
  /** 单元地址 key（`WorkspaceSession.key()`，与注册表快照同源）。 */
  workspaceKey: string;
}

/**
 * 某单元的会话子列表（侧栏投影的**装配件**）。
 *
 * 只做三件装配：从快照里取本单元的会话、算出「哪一行是前台」、把点击接到 tab 激活。
 * 视觉与交互全在 `SessionList`（shared），本组件不重复任何一条。
 *
 * 只在单元行**展开时**挂载（`SessionRow.children` 的折叠语义），因此这里的 store 订阅
 * 与按行订阅 agent 图标的成本都只发生在用户主动展开的单元上。
 */
const UnitSessionList: React.FC<UnitSessionListProps> = ({ workspaceKey }) => {
  const byUnit = useSessionsByUnit();
  const tabSpace = useEditorStore((s) => s.tabs[workspaceKey]);
  const activeTabId = useEditorStore((s) => selectActiveTabId(s, workspaceKey));
  const activate = useActivateSession();

  const unitSessions = byUnit.get(workspaceKey) ?? NO_SESSIONS;

  const activeSession = useMemo(() => {
    const activeTab = tabSpace?.tabs.find((tab) => tab.id === activeTabId);
    return tabSession(activeTab, unitSessions);
  }, [tabSpace, activeTabId, unitSessions]);

  return (
    <SessionList sessions={unitSessions} activeSession={activeSession} onActivate={activate} />
  );
};

export default React.memo(UnitSessionList);
