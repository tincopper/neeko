import React, { useCallback, useMemo } from 'react';

import { UnitTeamEntries } from '@/features/agent-team';
import { useProjectActionsContext } from '@/shared/contexts/ProjectActionsContext';
import { useActiveSessionRefs } from '@/shared/hooks/useActiveSessionRefs';
import { useSessionsByUnit } from '@/shared/hooks/useSessionsByUnit';
import { isSameSession, NO_SESSIONS } from '@/shared/selectors/liveSessionSelectors';
import type { SessionView } from '@/shared/types/liveSessions';

import { useActivateSession } from '../hooks/useActivateSession';
import { useSessionRowActions } from '../hooks/useSessionRowActions';
import { useTeamEntryActions } from '../hooks/useTeamEntryActions';

import SessionList from './SessionList';

interface UnitSessionListProps {
  /** 单元地址 key（`WorkspaceSession.key()`，与注册表快照同源）。 */
  workspaceKey: string;
  /**
   * 「把这个单元亮出来」—— 切项目 / 切单元 / 切到终端视图。
   *
   * 由调用方注入而不是本组件自己拼：每个侧栏（本地 / WSL / SSH）已经有**一份**正确的
   * 切换序列（`handleOpenWorktreeTerminal` / `onSelectProject`），这里再写一遍就是第二份
   * 实现，而漏掉其中一步（`setViewTerminal` / `markWorkspaceOpened`）的表现正是
   * 「点了没反应」—— 视图还停在别处。
   */
  onRevealUnit?: () => void;
}

/**
 * 某单元的会话子列表（侧栏投影的**装配件**）。
 *
 * 只做四件装配：从快照里取本单元的会话、从**当前前台会话的唯一派生点**取高亮行、
 * 把点击接到 tab 激活、把**团队行**放在会话子列表旁边。视觉与交互全在同域组件
 * （`SessionList` / `UnitTeamEntries`），本组件不重复任何一条。
 *
 * # 为什么团队行只在这里挂载（design §3）
 *
 * 三个侧栏变体（本地项目树 / 工作树列表 / WSL·SSH 连接卡）都经由本组件，因此渲染点只有
 * 一处 —— 不会出现「本地有团队行、远程没有」的漂移。依赖方向是「live-sessions → agent-team
 * 的**门面**」（`agent-team` 不反过来依赖本域），与已有的 `agent` / `terminal` 依赖同类。
 *
 * 无团队的单元：`UnitTeamEntries` 渲染 `null`，本组件的输出与今天逐字一致。
 *
 * 只在单元行**展开时**挂载（`SessionRow.children` 的折叠语义），因此这里的 store 订阅
 * 与按行订阅 agent 图标的成本都只发生在用户主动展开的单元上。
 */
const UnitSessionList: React.FC<UnitSessionListProps> = ({ workspaceKey, onRevealUnit }) => {
  const byUnit = useSessionsByUnit();
  // R8：高亮只能来自「当前激活项目 + 当前激活单元」的前台 tab 空间。
  // 本单元的 `editorLayout[workspaceKey].activeTabId` 只是恢复语义（局部状态），
  // 直接用它会让切走后旧单元仍亮着；refs 已编码当前单元，不必再比一次 activeKey。
  const refs = useActiveSessionRefs();
  // 「切项目」的唯一序列由 provider 提供（缺 provider 抛错 —— 静默不切项目正是要修的缺陷）。
  const { onSelectProject } = useProjectActionsContext();
  const activate = useActivateSession(onSelectProject);
  const { rename, remove } = useSessionRowActions();
  const teamActions = useTeamEntryActions();

  const unitSessions = byUnit.get(workspaceKey) ?? NO_SESSIONS;

  // refs 的顺序就是前台优先级（中心 → DOCK_SLOTS）：一个单元可能同时有中心会话与
  // dock 会话在展示，此时「哪一行亮」不能由快照顺序决定 —— 那是后端的事。
  // 按 refs 外层迭代，让选中行与 `useUnitsWithActiveSession`（父行让出选中底）同源。
  const activeSession = useMemo(() => {
    for (const ref of refs) {
      if (ref.workspaceKey !== workspaceKey) continue;
      const matched = unitSessions.find((session) => isSameSession(session, ref));
      if (matched) return matched;
    }
    return null;
  }, [unitSessions, refs, workspaceKey]);

  const handleActivate = useCallback(
    (session: SessionView) => {
      // 先把单元亮出来，再激活 tab：反过来会先切 tab 再切视图，中间那一帧是白屏。
      onRevealUnit?.();
      activate(session);
    },
    [activate, onRevealUnit],
  );

  return (
    <>
      {/* 团队行在会话子列表**之前**：它是单元的入口（团队的生命周期比任何一条 PTY 长），
          排在用户自己的会话之上才不会随「最近会话」的排序漂移。 */}
      <UnitTeamEntries
        workspaceKey={workspaceKey}
        onOpenLead={teamActions.onOpenLead}
        onOpenTeamPanel={teamActions.onOpenTeamPanel}
        onOpenBoard={teamActions.onOpenBoard}
      />
      <SessionList
        sessions={unitSessions}
        activeSession={activeSession}
        onActivate={handleActivate}
        onRename={rename}
        onDelete={remove}
      />
    </>
  );
};

export default React.memo(UnitSessionList);
