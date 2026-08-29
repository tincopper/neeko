import { useMemo } from 'react';

import DockBarButton from '@/app/components/DockBarButton';
import { useDockStore } from '@/shared/store/dockStore';

/**
 * 组装某一侧的 dock 栏按钮（ReactNode[]），供 AppShell 经 DockLayout 的 DockBar 容器渲染。
 * 纯展示映射：从 dockStore.barItems filter + sort + render。
 * 文件名 PascalCase（含 JSX 的 .tsx 需满足 check-file 命名规则），hook 仍为 camelCase。
 */
export function useDockBarButtons(side: 'left' | 'right'): React.ReactNode[] {
  const rawBarItems = useDockStore((s) => s.barItems);

  return useMemo(
    () =>
      rawBarItems
        .filter((item) => item.side === side && item.visible)
        .sort((a, b) => a.order - b.order)
        .map((item) => <DockBarButton key={item.panelId} panelId={item.panelId} side={side} />),
    [rawBarItems, side],
  );
}
