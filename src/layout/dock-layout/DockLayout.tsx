import React, { useCallback, useEffect, useRef } from 'react';
import { usePanelRef, type Layout, type LayoutChangedMeta } from 'react-resizable-panels';

import { useDockStore } from '@/shared/store/dockStore';
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from '@/ui/Resizable';

import { useDockRegistry } from '../DockRegistryContext';

import DockBar from './DockBar';
import DockZone from './DockZone';

/** must match the ResizablePanel minSize below */
const MIN_RIGHT_ZONE_SIZE = 12;

/** Right zone fallback width when no size is known for the active panel. */
const DEFAULT_RIGHT_ZONE_SIZE = 18;

interface DockLayoutProps {
  children: React.ReactNode;
  /** Left toolbar footer slot for app-level actions */
  toolbarFooterLeft?: React.ReactNode;
  /** Left dock bar buttons */
  leftButtons?: React.ReactNode[];
  /** Right dock bar buttons */
  rightButtons?: React.ReactNode[];
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
  leftButtons = [],
  rightButtons = [],
}) => {
  const leftExpanded = useDockStore((s) => s.zones.left?.expanded ?? true);

  const rightExpanded = useDockStore((s) => s.zones.right?.expanded ?? false);

  const rightActivePanelId = useDockStore((s) => s.zones.right?.activePanelId ?? null);

  const rightPanelSizes = useDockStore((s) => s.rightPanelSizes);
  const setRightPanelSize = useDockStore((s) => s.setRightPanelSize);
  const leftPanelSize = useDockStore((s) => s.leftPanelSize);
  const setLeftPanelSize = useDockStore((s) => s.setLeftPanelSize);

  const rightPanelIds = useDockStore((s) => s.zones.right?.panels ?? []);
  const dockPanelRegistry = useDockRegistry();

  // 持久化策略见下方 handleLayoutChanged：拖动期间零 store 写入，defaultSize
  // 可直接绑定 store 值（无需「150ms 去抖 + defaultSize 快照」断负反馈 hack）。

  const rightVisible = rightPanelIds.length > 0 && rightExpanded;

  /** Resolve target zone width for a given panel: store value → registry default → DEFAULT_RIGHT_ZONE_SIZE.
   *  Always returns at least MIN_RIGHT_ZONE_SIZE to match the panel's minSize constraint,
   *  preventing the zone from appearing invisible after first expand. */
  const getRightPanelSize = useCallback(
    (panelId: string | null): number => {
      if (!panelId) return DEFAULT_RIGHT_ZONE_SIZE;
      if (rightPanelSizes[panelId] != null)
        return Math.max(rightPanelSizes[panelId], MIN_RIGHT_ZONE_SIZE);
      const def = dockPanelRegistry[panelId];
      return Math.max(def?.defaultZoneSize ?? DEFAULT_RIGHT_ZONE_SIZE, MIN_RIGHT_ZONE_SIZE);
    },
    [rightPanelSizes, dockPanelRegistry],
  );

  // -- Panel imperative refs for collapse/expand --
  const leftZonePanelRef = usePanelRef();
  const rightPanelRef = usePanelRef();
  const prevRightPanelIdRef = useRef<string | null>(rightActivePanelId);

  // -- Left panel: collapse/expand imperatively instead of key-based remount --
  const leftExpandedRef = useRef(leftExpanded);
  useEffect(() => {
    const prev = leftExpandedRef.current;
    leftExpandedRef.current = leftExpanded;
    if (prev === leftExpanded) return;

    const panel = leftZonePanelRef.current;
    if (!panel) return;

    if (leftExpanded) {
      panel.expand();
      // 确定性恢复：显式 resize 到 store 记忆尺寸，不依赖库内部
      // 「最近展开尺寸」记忆 —— defaultSize 直绑 store 后，拖动持久化触发的
      // 约束重排会污染该内部记忆，导致重展开回退到初始默认宽度。
      // 双 rAF 对齐右栏模式：等 expand() 内部布局 settle + 并发 remount
      // 完成 first paint 后再执行 resize。
      const targetSize = leftPanelSize;
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          leftZonePanelRef.current?.resize(`${targetSize}%`);
        });
      });
    } else {
      panel.collapse();
    }
  }, [leftExpanded, leftZonePanelRef, leftPanelSize]);

  // -- Right panel: collapse/expand imperatively instead of key-based remount --
  const rightVisibleRef = useRef(rightVisible);
  useEffect(() => {
    const prev = rightVisibleRef.current;
    rightVisibleRef.current = rightVisible;
    if (prev === rightVisible) return;

    const panel = rightPanelRef.current;
    if (!panel) return;

    if (rightVisible) {
      panel.expand();
      // After expand, resize to the target size for the active panel.
      // Use double-rAF: the first frame lets expand() settle its internal
      // layout state; the second frame executes the resize after any
      // concurrent EditorGroupLayout remount (triggered by pin/unpin) has
      // also completed its first paint — preventing a race that left the
      // panel at 0 width when opening a side panel right after pinning a tab.
      const targetSize = getRightPanelSize(rightActivePanelId);
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          rightPanelRef.current?.resize(`${targetSize}%`);
        });
      });
    } else {
      panel.collapse();
    }
  }, [rightVisible, rightPanelRef, getRightPanelSize, rightActivePanelId]);

  // Resize right zone to target size when active panel changes (instant, no CSS transition)
  useEffect(() => {
    const prev = prevRightPanelIdRef.current;
    prevRightPanelIdRef.current = rightActivePanelId;

    if (prev === rightActivePanelId) return;
    if (!rightVisible) return;

    const panel = rightPanelRef.current;
    if (!panel) return;

    const targetSize = getRightPanelSize(rightActivePanelId);
    panel.resize(`${targetSize}%`);
  }, [rightActivePanelId, rightVisible, getRightPanelSize, rightPanelRef]);

  // ── Layout persistence（Group 级 onLayoutChanged：pointer-up 语义）─────
  // 拖动只在松手时触发一次（键盘 resize 立即触发）；meta.isUserInteraction
  // 过滤掉 imperative expand()/resize() 与初始挂载等程序性变化，因此 store
  // 写入天然不与拖动并发 —— 无需去抖，也不会形成「持久化 → defaultSize 变化 →
  // 库重置布局」的拖动负反馈。替代原双份「onResize + 150ms 去抖」方案。
  const handleLayoutChanged = useCallback(
    (_layout: Layout, meta: LayoutChangedMeta) => {
      if (!meta.isUserInteraction) return;

      // 左 zone：折叠态（0%）不入库。回调触发时尺寸已 settle，直接从
      // imperative handle 读最终值（比 flexGrow 换算百分比更可靠）。
      const left = leftZonePanelRef.current?.getSize();
      if (leftExpanded && left && left.asPercentage > 0) {
        setLeftPanelSize(left.asPercentage);
      }

      // 右 zone：只持久化 ≥ minSize 的值，防止折叠/过渡尺寸污染存储。
      const right = rightPanelRef.current?.getSize();
      if (
        rightVisible &&
        rightActivePanelId &&
        right &&
        right.asPercentage >= MIN_RIGHT_ZONE_SIZE
      ) {
        setRightPanelSize(rightActivePanelId, right.asPercentage);
      }
    },
    [
      leftZonePanelRef,
      rightPanelRef,
      leftExpanded,
      rightVisible,
      rightActivePanelId,
      setLeftPanelSize,
      setRightPanelSize,
    ],
  );

  const setLeftPanelWidth = useDockStore((s) => s.setLeftPanelWidth);

  const leftPanelElRef = useRef<HTMLDivElement>(null);

  // ResizeObserver: fires on mount (initial size) + every resize drag.
  // Re-runs when leftExpanded toggles so the observer re-attaches after expand.
  useEffect(() => {
    if (!leftExpanded) {
      setLeftPanelWidth(0);
      return;
    }
    const el = leftPanelElRef.current;
    if (!el) return;

    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? 0;
      setLeftPanelWidth(width);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [leftExpanded, setLeftPanelWidth]);

  // Dock panel toggle shortcuts: see shortcutRegistry + useKeyboardShortcuts.

  return (
    <div className="flex flex-1 min-h-0 bg-bg-primary">
      {/* Left toolbar column: icon bar + optional footer */}
      <div className="flex flex-col shrink-0">
        <DockBar side="left" buttons={leftButtons} />
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
          defaultSize={leftExpanded ? `${leftPanelSize}%` : '0%'}
          collapsible
          collapsedSize="0%"
          minSize="12%"
          maxSize="35%"
          className="py-0.5 pr-px"
          elementRef={leftPanelElRef}
          panelRef={leftZonePanelRef}
        >
          <DockZone zoneId="left" />
        </ResizablePanel>

        <ResizableHandle
          id="handle-left-center"
          withHandle
          disabled={!leftExpanded}
          className={leftExpanded ? undefined : '!w-0 !cursor-default'}
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
          defaultSize={rightVisible ? `${getRightPanelSize(rightActivePanelId)}%` : '0%'}
          collapsible
          collapsedSize="0%"
          minSize="12%"
          maxSize="80%"
          className="py-0.5 pl-px"
          panelRef={rightPanelRef}
        >
          <DockZone zoneId="right" />
        </ResizablePanel>
      </ResizablePanelGroup>

      {/* Right toolbar column */}
      <div className="flex flex-col shrink-0">
        <DockBar side="right" buttons={rightButtons} />
      </div>
    </div>
  );
};

export default React.memo(DockLayout);
