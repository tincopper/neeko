import React, { useCallback } from 'react';

import { useMoveTabToSlot } from '@/app/hooks/useMoveTabToSlot';
import { useRemoteProjectSession } from '@/app/hooks/useRemoteProjectSession';
import { buildLayoutId } from '@/app/utils/layoutId';
import { DockTabHost } from '@/features/dock-tabs';
import { useConnectionProjectContext } from '@/shared/contexts/ConnectionProjectContext';
import type { DockSlot } from '@/shared/dock';
import { useProjectStore } from '@/shared/store/projectStore';
import { useActiveWorkspaceKey } from '@/shared/store/workspaceStore';

/**
 * 槽位 tab 宿主的 app 适配层：解析「当前激活 workspace 的 tab 空间键」并挂上宿主。
 *
 * 三件事都只能在 app 层做（feature 不依赖 app 层 / workspace 身份源）：
 * 1. `tabKey` —— 宿主显示哪个 workspace 的停靠 tab（I4：布局全局，内容是 tabKey 的投影）；
 * 2. `layoutId` —— 终端分屏布局的持久化键，与中心组同一派生点（`buildLayoutId`）；
 * 3. `onMoveTabToSlot` —— 唯一跨 store 编排点 `app/utils/tabSurface.moveTabToSlot`。
 *
 * **slot 由注册表 wrapper 传入**（两个导出，各绑一个 ViewKey）：禁止宿主从当前
 * `activeView` 反推「我是左还是右」—— 那是同一事实的第二份表示。
 */
const DockTabHostSlot: React.FC<{ slot: DockSlot }> = ({ slot }) => {
  const project = useProjectStore((s) => s.activeProject);
  // 无激活项目 → tabKey = null → 宿主空态（不是空白死区）
  const tabKey = useActiveWorkspaceKey(project?.id ?? null);
  const { remoteAuthStore, activeRemoteCheckoutPath, setRemoteOpenSessions, setPendingAuthEntry } =
    useConnectionProjectContext();
  // 停靠的终端可能是 SSH 项目的：remoteConfig 与中心组同源（复用会话派生，不新写一份）
  const { remoteProjectProp } = useRemoteProjectSession({
    activeProject: project,
    remoteAuthStore,
    activeRemoteCheckoutPath,
    setRemoteOpenSessions,
    setPendingAuthEntry,
  });
  const { move: onMoveTabToSlot, canDock: canDockTab } = useMoveTabToSlot(tabKey);

  const buildHostLayoutId = useCallback(
    (paneId: string, tabId: string | null) => buildLayoutId(project, paneId, tabId),
    [project],
  );

  return (
    <DockTabHost
      slot={slot}
      tabKey={tabKey}
      remoteProject={remoteProjectProp}
      buildLayoutId={buildHostLayoutId}
      onMoveTabToSlot={onMoveTabToSlot}
      canDockTab={canDockTab}
    />
  );
};

const DockTabHostLeftWrapper: React.FC = React.memo(() => <DockTabHostSlot slot="left" />);
const DockTabHostRightWrapper: React.FC = React.memo(() => <DockTabHostSlot slot="right" />);

DockTabHostLeftWrapper.displayName = 'DockTabHostLeftWrapper';
DockTabHostRightWrapper.displayName = 'DockTabHostRightWrapper';

export { DockTabHostLeftWrapper, DockTabHostRightWrapper };
