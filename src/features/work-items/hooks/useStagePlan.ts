/**
 * Tasks 面板的阶段轨（`work_item_stage_plan`）。
 *
 * # 为什么 `loading` 是 hook 本地状态而不是 store 字段
 *
 * 阶段轨只有一份、全局只拉一次，而「拉没拉到」是**这一次挂载**的视角问题：并发挂载的两个组件
 * 都该在等待期看到 `loading`，拿到之后都该是 `false`。放进 store 就会变成一份需要手工维护的
 * 全局标志位（谁置 true、谁置 false、卸载时要不要清），而它真正的语义只是 `plan === null`。
 *
 * # 为什么失败不抛
 *
 * 轨道拉不到时 `plan` 保持 `null`，调用方据此**不渲染**轨道（`stageRail.ts` 的 `stageNodes`
 * 需要 plan，没有就是没有）—— 这比在面板里抛错更接近事实：任务列表本身还是好的。下一次挂载会
 * 重试（store 只缓存成功的结果）。
 */
import { useEffect, useRef, useState } from 'react';

import { useWorkItemsStore } from '../store/workItemsStore';
import type { StagePlan } from '../types';

export interface UseStagePlanResult {
  /** `null` = 还没拿到（轨道不渲染）。 */
  plan: StagePlan | null;
  loading: boolean;
}

export function useStagePlan(): UseStagePlanResult {
  const plan = useWorkItemsStore((state) => state.plan);
  const loadPlan = useWorkItemsStore((state) => state.loadPlan);
  /** 初值即「还没拿到」：不在 effect 里同步置 `true`（那等于为一次已知状态多付一次渲染）。 */
  const [loading, setLoading] = useState(plan === null);

  /**
   * 挂载闩：卸载后不再 `setState`（dock 面板会反复挂载卸载）。
   *
   * **不能**用「effect 的 cleanup 置假」来当这个闩：`plan` 到手时 effect 会再跑一次，cleanup 先执行，
   * 于是「拉完了」这条消息被当成「卸载了」丢掉 —— `loading` 永远停在 `true`。挂载闩必须与
   * `plan` 无关，只跟组件生死走。
   */
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    // 整个 app 里只拉一次：store 侧还有一道「已有 / 在飞就复用」的守卫，这里只是不白跑一趟。
    if (plan !== null) return;
    void loadPlan().finally(() => {
      if (mounted.current) setLoading(false);
    });
  }, [plan, loadPlan]);

  return { plan, loading };
}
