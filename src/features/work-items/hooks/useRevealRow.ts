import { useEffect, useState } from 'react';
import type React from 'react';

/**
 * 「把某一行滚进视野」的唯一入口（design §11.7「创建后自动滚动到新卡片」）。
 *
 * # 只在**本面板发起 create** 时被调用
 *
 * 列表变化不滚。5 秒后延迟提交的删除失败会让那一行**自己回到列表**
 * （`store/workItemsStore.ts` 的 `commitDelete`），那不是新建；对任意列表变化滚动，
 * 等于把一次失败的删除描述成一次新任务（spec `frontend/state-management.md` 契约 8）。
 * 所以这里不做「列表变长就滚」的观察者 —— 只有 create 成功的那个调用点会 `reveal(id)`。
 *
 * # 为什么是 `scrollIntoView({ block: 'nearest' })`
 *
 * `nearest` 是「已经可见就不动」：卡片常常本来就落在列顶（`updatedAt DESC` ⇒ 新建项在第一位），
 * 用 `start` 会把列硬拽一下，看起来像丢了一次滚动位置。jsdom 里它是 no-op，所以组件测试用
 * spy 断言调用与参数（真实滚动位置在 jsdom 里没有意义）。
 */
export function useRevealRow(
  containerRef: React.RefObject<HTMLElement | null>,
): (id: string) => void {
  /** 待揭示的行。`null` = 没有待揭示的（不是「滚到第一行」）。 */
  const [revealId, setRevealId] = useState<string | null>(null);

  useEffect(() => {
    if (revealId === null) return;

    // 卡片可能不在 DOM 里（被搜索过滤掉 / 已删除）：那就什么都不做，而不是滚到别处去。
    const row = containerRef.current?.querySelector(`[data-work-item-id="${revealId}"]`);
    if (row instanceof HTMLElement) row.scrollIntoView({ block: 'nearest' });
  }, [containerRef, revealId]);

  // 不复位 `revealId`：effect 只在 id **变化**时重跑，所以同一次挂载里的其它列表变化不会
  // 重新滚一遍（那才是「任意列表变化都滚」）。同一个 id 出现两次也不需要重滚 —— `create`
  // 每次都发一个新 id。
  return setRevealId;
}
