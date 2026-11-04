import React from 'react';

import { dockPanelIcons, dockPanelRegistry } from '@/app/dock/registry';
import type { ViewKey } from '@/shared/dock';

interface DockBarDragPreviewProps {
  view: ViewKey;
}

/**
 * 拖拽跟手预览（`DragOverlay` 的内容，纯展示）。
 *
 * 外框 44px / 内层 32px chip / 20px 图标，与 `DockBarButton` 里的图标位逐一对应 ——
 * 浮层若比源图标小一圈，松手时的落点就会看着「跳」一下。
 *
 * 刻意不带交互语义（无 `button` / tooltip / dnd listeners）：overlay 由 dnd-kit 移动，
 * 可交互子元素会产生误触，且读屏会把它当成第二个同名按钮。
 *
 * 落点在 **app 层**而不是 `layout/dock-layout`：图标映射（`dockPanelIcons`）只存在于
 * app registry，而 `layout/` 禁止 import app。预览经 `DockBarEntry.preview` 注入。
 */
const DockBarDragPreview: React.FC<DockBarDragPreviewProps> = ({ view }) => {
  const def = dockPanelRegistry[view];
  if (!def) return null;

  const Icon = dockPanelIcons[def.icon];

  return (
    <div data-testid="dock-bar-drag-preview" className="flex items-center justify-center w-11 h-11">
      <span
        className={
          'flex items-center justify-center w-8 h-8 rounded-md bg-bg-selected text-text-primary ' +
          'shadow-lg shadow-black/20 cursor-grabbing'
        }
      >
        {Icon ? <Icon className="h-5 w-5" /> : <span>{def.title[0]}</span>}
      </span>
    </div>
  );
};

DockBarDragPreview.displayName = 'DockBarDragPreview';

export default React.memo(DockBarDragPreview);
