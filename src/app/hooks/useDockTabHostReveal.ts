import { useEffect, useRef } from 'react';

import { DOCK_SLOTS, tabHostView } from '@/shared/dock';
import { useDockStore } from '@/shared/store/dockStore';

import type { DockTabHostContent } from './useDockTabHostContent';

/**
 * 「内容到达即前置」的**唯一**实现（P6）：某槽宿主里可渲染 tab 的**条数增加**时，
 * 把该槽激活并展开，让刚到的内容出现在用户眼前。
 *
 * **判据是「到达 = 条数增加」，不是布尔跃迁**（P6-2b）。布尔跃迁漏掉的正是最常见的一击：
 * 槽已折叠、宿主已非空（1 条），侧栏又点一个会话（2 条）—— 没有假 → 真跃迁，于是那次点击
 * 完全无反应。计数比较覆盖它，且不需要第二个判据：`useDockTabHostContent` 与可见性判据
 * `isZoneRenderable` 读的是同一个计数（`> 0` 只在 `isZoneRenderable` 内部决定一处）。
 * 不变 / 减少一律不动：关 tab 不得把用户收起的槽重新打开。
 *
 * **为什么在 app 层而不是宿主组件（`DockTabHost`）里**：宿主只在「槽展开 ∧ 自己是前台」
 * 时挂载（`DockZone` 对收起的槽 `return null`）。写在宿主的 effect 里，自动停靠
 * （Action Menu / 侧栏点会话 / history 恢复 —— 它们只经 `addTab` 问种类策略
 * `docksNewTabs`，不经过 `moveTabToSlot`）在**槽收起时永远等不到那次 effect**：tab 建好了
 * 却看不见。揭示是「内容的函数」，不能依赖某个组件是否挂载 —— 于是这里是四条入口
 * （图标 / 菜单 / 自动停靠 / 切单元）唯一且一致的落地点，宿主从此**零布局写入**
 * （只读布局、渲染内容）。
 *
 * **为什么不在 `registerTabSurfacePolicy` 的 updater 里做**：那个策略回调跑在
 * `editorStore.addTab` 的 `set((state) => …)` **updater 内部** —— 在纯推导里写另一个 store
 * 是副作用（updater 重跑会重复触发），也是跨域耦合。
 *
 * 只在**条数增加**时触发，初值取当前值 ⇒ 挂载时不触发（已经存在的内容不该把面板从
 * 用户手里抢走）。
 *
 * 两条已经拍板的行为（不特判，有意如此）：
 *
 * 1. **切工作区构成到达**：计数按**当前单元**重算（`useDockTabHostContent` 的键是
 *    `useActiveWorkspaceKey`），所以新单元的条数高于旧单元时同样算到达，揭示会执行。
 *    这与「内容到达即前置」自洽 —— 该单元的内容刚刚变得可渲染。
 * 2. **揭示会退出 Library**：`dockStore.activateView` 的既有语义就是「打开任何 dock 面板
 *    即退出全宽中心视图」（中心视图互斥），不变。要改这一点应该改 `activateView` 的语义，
 *    不得在这条路径上加特判。
 */
export function useDockTabHostReveal(counts: DockTabHostContent): void {
  const prevRef = useRef(counts);

  useEffect(() => {
    const prev = prevRef.current;
    prevRef.current = counts;
    // 两槽同一规则（不特判）：槽位身份来自 `DOCK_SLOTS`，新增槽位自动被覆盖。
    for (const slot of DOCK_SLOTS) {
      if (counts[slot] <= prev[slot]) continue;
      // `activateView` 自身幂等（前台已是该宿主且展开时直接早退），所以「揭示」与
      // `moveTabToSlot` 里那次显式展开重叠时不会产生第二次写入。
      useDockStore.getState().activateView(tabHostView(slot));
    }
  }, [counts]);
}
