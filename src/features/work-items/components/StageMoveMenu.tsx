import React, { useCallback } from 'react';

import {
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
} from '@/ui/ContextMenu';

/**
 * 卡片右键菜单里的「Move to」（design §11.5 方式三）：只列**可直接流转**的 stage。
 *
 * # 为什么 locked / current **不出现**（而不是置灰留原因）
 *
 * 菜单是一份**可执行命令的清单**。把它变成「一条能点 + 四条不能点」会让每次右键都先读一遍
 * 「哪些不能做」—— 而 `current` 那一条更是零信息（卡片就在那一列里）。「为什么不能跳过去」
 * 这个问题的答案属于**阶段轨**：详情面板的 Stage Rail 会把整条轨道按 current / reachable /
 * locked 画出来（`utils/stageRail.ts` 是唯一判据）。两处各画一半，就会出现
 * 「菜单里能点、轨道里是灰的」这种自相矛盾的界面。
 *
 * 代价是：`stages` 为空时菜单里没有任何可点的项。那不是「没有菜单」，而是
 * 「这个阶段集里没有相邻阶段可去」—— 所以仍然画一条置灰的说明，而不是让右键毫无反应
 * （右键被接管了却什么都不弹，用户只会以为菜单坏了）。
 */
interface StageMoveMenuProps {
  /** **已过滤**的可流转目标（调用方用 `stageNodes` 筛出 `reachable`，本组件不重判可达性）。 */
  stages: string[];
  onMove: (stage: string) => void;
}

const StageMoveMenu: React.FC<StageMoveMenuProps> = React.memo(({ stages, onMove }) => {
  const handleSelect = useCallback((stage: string) => () => onMove(stage), [onMove]);

  return (
    <ContextMenuContent>
      <ContextMenuLabel className="px-2 py-1 text-micro font-semibold text-text-muted">
        Move to
      </ContextMenuLabel>
      <ContextMenuSeparator className="my-1 h-px bg-border" />
      {stages.length === 0 ? (
        <ContextMenuItem
          disabled
          className="px-2 py-1 text-micro text-text-muted data-[disabled]:pointer-events-none data-[disabled]:opacity-60"
        >
          没有可流转的阶段
        </ContextMenuItem>
      ) : (
        stages.map((stage) => (
          <ContextMenuItem
            key={stage}
            // `onSelect` 而不是 `onClick`：Radix 在选中后自己关菜单并还焦点，
            // 用 `onClick` 会漏掉键盘（Enter / Space）触发的那一次。
            onSelect={handleSelect(stage)}
            // 高亮走 `data-[highlighted]`（Radix 的键盘导航与鼠标 hover 都置这个属性），
            // 而不是 `:hover` —— 否则键盘上下移动时看不出来选中了哪一条。
            className="cursor-pointer rounded px-2 py-1 text-micro text-text-primary data-[highlighted]:bg-bg-hover data-[highlighted]:text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-blue"
          >
            {stage}
          </ContextMenuItem>
        ))
      )}
    </ContextMenuContent>
  );
});
StageMoveMenu.displayName = 'StageMoveMenu';

export default StageMoveMenu;
