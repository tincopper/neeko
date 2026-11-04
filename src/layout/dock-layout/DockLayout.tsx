import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { usePanelRef, type Layout, type LayoutChangedMeta } from 'react-resizable-panels';

import {
  DEFAULT_ZONE_SIZE_PERCENT,
  MIN_ZONE_SIZE_PERCENT,
  isZoneRenderable,
  zoneFrontView,
  type DockSlot,
  type ViewKey,
} from '@/shared/dock';
import { useDockStore } from '@/shared/store/dockStore';
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from '@/ui/Resizable';

import { useDockRegistry } from '../DockRegistryContext';

import DockBar, { type DockBarEntry } from './DockBar';
import DockBarDnd, { type MoveViewHandler } from './DockBarDnd';
import DockZone from './DockZone';
import { useZoneExpandCollapse } from './useZoneExpandCollapse';

/** 没有条目时不要每次渲染新建数组（DnD 的 memo / 依赖数组以它为输入）。 */
const NO_ENTRIES: DockBarEntry[] = [];

/** 未注入内容事实时的缺省：宿主没有可渲染 tab（fail-closed —— 不凭空占位）。 */
const NO_TAB_HOST_CONTENT: Record<DockSlot, number> = { left: 0, right: 0 };

interface DockLayoutProps {
  children: React.ReactNode;
  /** Left toolbar footer slot for app-level actions */
  toolbarFooterLeft?: React.ReactNode;
  /** Left / right dock bar entries (view identity + rendered button) */
  leftBarItems?: DockBarEntry[];
  rightBarItems?: DockBarEntry[];
  /** 图标跨栏 / 排序的唯一入口（app 注入；本层只把 dnd 落点翻译成 (view, slot, index)） */
  onMoveView?: MoveViewHandler;
  /**
   * 各槽的槽位宿主里**可渲染 tab 的条数**（app 注入，见 `useDockTabHostContent`）。
   *
   * zone 可见性 = **内容**的函数（展开 ∧ 前台有内容）：本层不掌握 tab 域，所以「宿主有多少
   * 内容」由 app 算好交进来 —— 与 `onMoveView` 同一规矩（layout 不得 import app / feature）。
   * 「非空」（`> 0`）只在 `isZoneRenderable` 内部决定一处，本层不做布尔映射。
   * 缺省 = 没有内容（fail-closed）。
   */
  tabHostTabCounts?: Record<DockSlot, number>;
}

/**
 * Top-level dock layout container.
 *
 * Implements IDEA 2026 Islands design: bg-primary acts as the "sea",
 * each panel is a floating "island" with rounded corners, borders,
 * and padding gaps between islands.
 *
 * Composes DockBar (left & right) + resizable panel group (left, center, right).
 * All dock state is managed internally via useDockStore -- zero state props needed.
 * 「谁在哪个槽、什么顺序、有无图标」只有一份真源（`placements`）：工具栏与 zone 都是
 * 它的派生投影，因此不存在「图标在 A 侧、面板开在 B 侧」的可表示状态。
 *
 * Panel toggle shortcuts are registered in shortcutRegistry
 * (`toggleDockProjects` / `toggleDockSkills`) and handled by useKeyboardShortcuts.
 *
 * IMPORTANT: Uses collapsible panels instead of key-based remount to avoid
 * react-resizable-panels global state corruption when nested Groups remount.
 * This fixes the bug where pinning a tab then opening a side panel caused
 * unresponsive drag handles.
 */
const DockLayout: React.FC<DockLayoutProps> = ({
  children,
  toolbarFooterLeft,
  leftBarItems = NO_ENTRIES,
  rightBarItems = NO_ENTRIES,
  onMoveView,
  tabHostTabCounts = NO_TAB_HOST_CONTENT,
}) => {
  const placements = useDockStore((s) => s.placements);
  const zones = useDockStore((s) => s.zones);
  const viewSizes = useDockStore((s) => s.viewSizes);
  const setViewSize = useDockStore((s) => s.setViewSize);
  const leftSlotSize = useDockStore((s) => s.leftSlotSize);
  const setLeftSlotSize = useDockStore((s) => s.setLeftSlotSize);

  const dockViewRegistry = useDockRegistry();

  // 可见性 = 展开 ∧ 前台视图有内容可渲染（`isZoneRenderable` 是唯一判据）。
  // 左右同一规则、不特判：左栏之所以通常可见，是因为它前台通常是 `projects`（无状态面板），
  // 不是因为它是左侧。空宿主因此**不占位**（既不用空岛、也不用文案解释为什么是空的）。
  const layoutState = useMemo(() => ({ placements, zones }), [placements, zones]);
  // 解构而不是两个独立 const：保持合并计算（两槽共享 `layoutState`）。
  const { left: leftVisible, right: rightVisible } = useMemo(
    () => ({
      left: isZoneRenderable(layoutState, 'left', tabHostTabCounts.left),
      right: isZoneRenderable(layoutState, 'right', tabHostTabCounts.right),
    }),
    [layoutState, tabHostTabCounts.left, tabHostTabCounts.right],
  );

  // 前台 = 布局事实的唯一派生点（含「activeView 指向 host:'none' 时回落」），
  // 尺寸记忆与 resize 效果都以它为准 —— 不要在消费侧再算一遍 `activeView`。
  const rightFrontView = zoneFrontView(layoutState, 'right');

  // 持久化策略见下方 handleLayoutChanged：拖动期间零 store 写入，defaultSize
  // 可直接绑定 store 值（无需「150ms 去抖 + defaultSize 快照」断负反馈 hack）。

  /** Resolve target zone width for a given view: store value → meta default → global default.
   *  Always returns at least MIN_ZONE_SIZE_PERCENT to match the panel's minSize constraint,
   *  preventing the zone from appearing invisible after first expand. */
  const getRightViewSize = useCallback(
    (view: ViewKey | null): number => {
      if (!view) return DEFAULT_ZONE_SIZE_PERCENT;
      const saved = viewSizes[view];
      if (saved != null) return Math.max(saved, MIN_ZONE_SIZE_PERCENT);
      const def = dockViewRegistry[view];
      return Math.max(def?.defaultSlotSize ?? DEFAULT_ZONE_SIZE_PERCENT, MIN_ZONE_SIZE_PERCENT);
    },
    [viewSizes, dockViewRegistry],
  );

  // -- Panel imperative refs for collapse/expand --
  const leftZonePanelRef = usePanelRef();
  const rightPanelRef = usePanelRef();
  const prevRightFrontViewRef = useRef<ViewKey | null>(rightFrontView);

  // -- Left panel: collapse/expand imperatively instead of key-based remount --
  // 确定性恢复：显式 resize 到 store 记忆尺寸，不依赖库内部「最近展开尺寸」记忆 ——
  // defaultSize 直绑 store 后，拖动持久化触发的约束重排会污染该内部记忆，导致
  // 重展开回退到初始默认宽度（双 rAF 时序见 useZoneExpandCollapse）。
  useZoneExpandCollapse(leftZonePanelRef, leftVisible, leftSlotSize);

  // -- Right panel: collapse/expand imperatively instead of key-based remount --
  useZoneExpandCollapse(rightPanelRef, rightVisible, getRightViewSize(rightFrontView));

  // Resize right zone to target size when the active view changes (instant, no CSS transition)
  useEffect(() => {
    const prev = prevRightFrontViewRef.current;
    prevRightFrontViewRef.current = rightFrontView;

    if (prev === rightFrontView) return;
    if (!rightVisible) return;

    const panel = rightPanelRef.current;
    if (!panel) return;

    const targetSize = getRightViewSize(rightFrontView);
    panel.resize(`${targetSize}%`);
  }, [rightFrontView, rightVisible, getRightViewSize, rightPanelRef]);

  // ── Layout persistence（Group 级 onLayoutChanged：pointer-up 语义）─────
  // 拖动只在松手时触发一次（键盘 resize 立即触发）；meta.isUserInteraction
  // 过滤掉 imperative expand()/resize() 与初始挂载等程序性变化，因此 store
  // 写入天然不与拖动并发 —— 无需去抖，也不会形成「持久化 → defaultSize 变化 →
  // 库重置布局」的拖动负反馈。替代原双份「onResize + 150ms 去抖」方案。
  const handleLayoutChanged = useCallback(
    (_layout: Layout, meta: LayoutChangedMeta) => {
      if (!meta.isUserInteraction) return;

      // 左 zone：折叠态（0%）/ 无内容（不占位）不入库。回调触发时尺寸已 settle，直接从
      // imperative handle 读最终值（比 flexGrow 换算百分比更可靠）。
      const left = leftZonePanelRef.current?.getSize();
      if (leftVisible && left && left.asPercentage > 0) {
        setLeftSlotSize(left.asPercentage);
      }

      // 右 zone：只持久化 ≥ minSize 的值，防止折叠/过渡尺寸污染存储。
      const right = rightPanelRef.current?.getSize();
      if (rightVisible && rightFrontView && right && right.asPercentage >= MIN_ZONE_SIZE_PERCENT) {
        setViewSize(rightFrontView, right.asPercentage);
      }
    },
    [
      leftZonePanelRef,
      rightPanelRef,
      leftVisible,
      rightVisible,
      rightFrontView,
      setLeftSlotSize,
      setViewSize,
    ],
  );

  return (
    // 两条 DockBar 共用同一个 DndContext：跨栏移动使它们属于同一个排序区域（见 DockBarDnd）
    <DockBarDnd leftBarItems={leftBarItems} rightBarItems={rightBarItems} onMoveView={onMoveView}>
      <div className="flex flex-1 min-h-0 bg-bg-primary">
        {/* Left toolbar column: icon bar + optional footer */}
        <div className="flex flex-col shrink-0">
          <DockBar side="left" items={leftBarItems} />
          {toolbarFooterLeft && (
            <>
              <div className="flex justify-center py-1.5">
                <div className="w-5 h-px bg-border" />
              </div>
              <div className="flex flex-col items-center gap-0.5 pb-1">{toolbarFooterLeft}</div>
            </>
          )}
        </div>

        {/* Resizable layout: left dock | center editor | right dock
            Uses collapsible panels instead of key-based remount to prevent
            react-resizable-panels internal state corruption with nested groups. */}
        <ResizablePanelGroup
          orientation="horizontal"
          id="neeko-main"
          className="flex-1"
          onLayoutChanged={handleLayoutChanged}
        >
          {/* Left dock zone (island) — collapsible, not conditionally rendered.
              defaultSize 直接绑定 store（拖动期间无写入，见 handleLayoutChanged 注释） */}
          <ResizablePanel
            id="left-zone"
            defaultSize={leftVisible ? `${leftSlotSize}%` : '0%'}
            collapsible
            collapsedSize="0%"
            minSize={`${MIN_ZONE_SIZE_PERCENT}%`}
            maxSize="35%"
            className="py-0.5 pr-px"
            panelRef={leftZonePanelRef}
          >
            <DockZone zoneId="left" />
          </ResizablePanel>

          <ResizableHandle
            id="handle-left-center"
            withHandle
            disabled={!leftVisible}
            className={leftVisible ? undefined : '!w-0 !cursor-default'}
          />

          {/* Center area: editor content (island) */}
          <ResizablePanel id="center-area" minSize="20%" className="py-0.5 px-px overflow-hidden">
            {children}
          </ResizablePanel>

          {/* Right dock zone (island) — collapsible, not conditionally rendered */}
          <ResizableHandle
            id="handle-center-right"
            withHandle
            disabled={!rightVisible}
            className={rightVisible ? undefined : '!w-0 !cursor-default'}
          />
          <ResizablePanel
            id="right-zone"
            defaultSize={rightVisible ? `${getRightViewSize(rightFrontView)}%` : '0%'}
            collapsible
            collapsedSize="0%"
            minSize={`${MIN_ZONE_SIZE_PERCENT}%`}
            maxSize="80%"
            className="py-0.5 pl-px"
            panelRef={rightPanelRef}
          >
            <DockZone zoneId="right" />
          </ResizablePanel>
        </ResizablePanelGroup>

        {/* Right toolbar column */}
        <div className="flex flex-col shrink-0">
          <DockBar side="right" items={rightBarItems} />
        </div>
      </div>
    </DockBarDnd>
  );
};

export default React.memo(DockLayout);
