import React, { useEffect, useRef } from 'react';

import { EditorGroupPane } from '@/features/editor';
import { isViewVisible, tabHostView, type DockSlot } from '@/shared/dock';
import { useDockStore } from '@/shared/store/dockStore';
import { DOCK_PANE_ID } from '@/shared/types/editorGroup';

import { useDockedPane } from '../hooks/useDockedPane';

const EMPTY_HINT_NO_WORKSPACE = 'Open a project to dock tabs here';
const EMPTY_HINT_NO_TABS =
  'No docked tabs — right-click a tab and choose "Move to Left/Right Dock"';

function noop(): void {}

export interface DockTabHostProps {
  slot: DockSlot;
  /** 当前激活 workspace 的 tab 空间键；`null` = 没有可投影的 workspace（空态）。 */
  tabKey: string | null;
  remoteProject?: React.ComponentProps<typeof EditorGroupPane>['remoteProject'];
  /** 终端分屏布局键的派生子（app 注入；feature 不依赖 app 层）。 */
  buildLayoutId: (paneId: string, tabId: string | null) => string;
  /** tab → 其它 surface（app 注入 `moveTabToSlot`）。 */
  onMoveTabToSlot?: (tabId: string, target: 'center' | DockSlot) => void;
}

const DockTabEmptyState: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="flex h-full items-center justify-center px-4 text-center text-xs text-text-muted">
    {children}
  </div>
);

/**
 * 槽位 tab 宿主：把当前 workspace 停靠在该槽的 tab 渲染出来。
 *
 * 复用中心的 `EditorGroupPane`（`chrome="dock"` 隐藏 Action Menu / 分屏控件 / Agent Bar），
 * 不为 dock 另写一套 tab 渲染（design §4 / §5）。`slot` 由注册表 wrapper 传入 —— 宿主不得
 * 从当前 `activeView` 反推自己是谁（那是同一事实的第二份表示）。
 *
 * I4：布局全局、可见集合是 tabKey 的投影 —— 切项目后该 workspace 没有停靠 tab 就渲染
 * 空态（不是空白死区）。
 */
const DockTabHost: React.FC<DockTabHostProps> = ({
  slot,
  tabKey,
  remoteProject,
  buildLayoutId,
  onMoveTabToSlot,
}) => {
  const paneId = DOCK_PANE_ID[slot];
  const { tabs, activeTabId } = useDockedPane(tabKey, slot);
  // 本宿主是否真的可见（槽位展开 + 本宿主为前台）：浏览器 tab 的 sub-webview 靠它开关
  // —— 未前台的槽位内容被 DockZone 用 CSS hidden 藏起，不能让 webview 还「以为自己在显示」。
  const isActivePane = useDockStore((s) => isViewVisible(s, tabHostView(slot)));
  const isActiveView = useDockStore((s) => s.zones[slot]?.activeView === tabHostView(slot));

  // 「关掉最后一条停靠 tab」= 宿主没东西可渲染 → 收起该槽，不留一座空岛。
  // 只在 **非空 → 空** 的跃迁上做：首次点图标展开一个空宿主是在给用户看引导文案，
  // 若也收起，那个图标就永远打不开了。
  const prevCountRef = useRef(tabs.length);
  useEffect(() => {
    const prev = prevCountRef.current;
    prevCountRef.current = tabs.length;
    if (prev > 0 && tabs.length === 0 && isActiveView) {
      useDockStore.getState().setSlotExpanded(slot, false);
    }
  }, [tabs.length, isActiveView, slot]);

  if (!tabKey) {
    return <DockTabEmptyState>{EMPTY_HINT_NO_WORKSPACE}</DockTabEmptyState>;
  }
  if (tabs.length === 0) {
    return <DockTabEmptyState>{EMPTY_HINT_NO_TABS}</DockTabEmptyState>;
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
      />
    </div>
  );
};

export default React.memo(DockTabHost);
