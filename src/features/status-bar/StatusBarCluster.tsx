import { useMemo, type ComponentType } from 'react';

import { itemsForSide } from './registry';
import type { StatusBarItemDef, StatusBarSide } from './types';

interface StatusBarClusterProps {
  side: StatusBarSide;
  /** 仅测试注入；缺省用 registry。非动态注册 API。 */
  items?: StatusBarItemDef[];
}

/**
 * 簇渲染器：按 side 分组、order 排序（order 冲突按 id 兜底），全渲染。
 * 互斥语义由 item 内部表达（如 LspSlotItem 的优先级链），渲染器不做认领——
 * render 期跨组件可变表被 react-hooks/immutability 禁止。
 * `return null` 的组件不占 flex 布局。
 */
export function StatusBarCluster({ side, items }: StatusBarClusterProps) {
  const sorted = useMemo(() => {
    const defs = items ?? itemsForSide(side);
    return [...defs].sort((a, b) => a.order - b.order || (a.id < b.id ? -1 : 1));
  }, [items, side]);

  return (
    <>
      {sorted.map((def) => {
        const C = def.component as ComponentType;
        return <C key={def.id} />;
      })}
    </>
  );
}
