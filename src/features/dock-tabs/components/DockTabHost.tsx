import React from 'react';

import { EditorGroupPane } from '@/features/editor';
import { isViewVisible, tabHostView, type DockSlot } from '@/shared/dock';
import { useDockStore } from '@/shared/store/dockStore';
import { DOCK_PANE_ID } from '@/shared/types/editorGroup';

import { useDockedPane } from '../hooks/useDockedPane';

function noop(): void {}

export interface DockTabHostProps {
  slot: DockSlot;
  /** 当前激活 workspace 的 tab 空间键；`null` = 没有可投影的 workspace（空渲染）。 */
  tabKey: string | null;
  remoteProject?: React.ComponentProps<typeof EditorGroupPane>['remoteProject'];
  /** 终端分屏布局键的派生子（app 注入；feature 不依赖 app 层）。 */
  buildLayoutId: (paneId: string, tabId: string | null) => string;
  /** tab → 其它 surface（app 注入 `moveTabToSlot`）。 */
  onMoveTabToSlot?: (tabId: string, target: 'center' | DockSlot) => void;
  /** 该 tab 能否停靠（app 注入；缺省 = 菜单不提供这项） */
  canDockTab?: (tabId: string) => boolean;
}

/**
 * 槽位 tab 宿主：把当前 workspace 停靠在该槽的 tab 渲染出来。
 *
 * 复用中心的 `EditorGroupPane`（`chrome="dock"` 隐藏 Action Menu / 分屏控件 / Agent Bar），
 * 不为 dock 另写一套 tab 渲染（design §4 / §5）。`slot` 由注册表 wrapper 传入 —— 宿主不得
 * 从当前 `activeView` 反推自己是谁（那是同一事实的第二份表示）。
 *
 * **宿主是内容的投影**（P5）：没有 tab 就渲染为空 —— 占不占位由布局层的派生判据
 * （`isZoneRenderable`：展开 ∧ 前台有内容）回答，**不在这个组件里解释/决定布局**。
 * 这也是 N→0「自动收起」被删掉的理由：那是把容器可见性写回 store（容器比内容活得久）。
 *
 * **宿主零布局写入**（P6）：只读布局、渲染内容。0→N 的「内容到达即前置」已上提到 app 层
 * （`useDockTabHostReveal`）—— 宿主的 effect 只有「已挂载」时才会跑，而收起的槽根本不挂载
 * 宿主，自动停靠（Action Menu / 侧栏点会话 / history 恢复）在那种状态下永远等不到它。
 * 揭示与可见性共用同一个内容事实（`useDockTabHostContent`），不再有第二份判据。
 */
const DockTabHost: React.FC<DockTabHostProps> = ({
  slot,
  tabKey,
  remoteProject,
  buildLayoutId,
  onMoveTabToSlot,
  canDockTab,
}) => {
  const paneId = DOCK_PANE_ID[slot];
  const { tabs, activeTabId } = useDockedPane(tabKey, slot);
  // 本宿主是否真的可见（槽位展开 + 本宿主为前台）：浏览器 tab 的 sub-webview 靠它开关
  // —— 未前台的槽位内容被 DockZone 用 CSS hidden 藏起，不能让 webview 还「以为自己在显示」。
  const isActivePane = useDockStore((s) => isViewVisible(s, tabHostView(slot)));

  if (!tabKey || tabs.length === 0) {
    return null;
  }

  // DockZone 的每视图包装是 `h-full w-full`（非 flex）：这里补一层 flex-column 宿主，
  // 否则 EditorGroupPane 根部的 `flex-1` 无 flex 父级、内容区会塌成 0 高。
  return (
    <div className="flex h-full min-h-0 flex-col">
      <EditorGroupPane
        paneId={paneId}
        chrome="dock"
        tabKey={tabKey}
        onFocusGroup={noop}
        remoteProject={remoteProject}
        layoutId={buildLayoutId(paneId, activeTabId)}
        isActivePane={isActivePane}
        onMoveTabToSlot={onMoveTabToSlot}
        canDockTab={canDockTab}
      />
    </div>
  );
};

export default React.memo(DockTabHost);
