import { useEffect } from 'react';

import { useTeamListStore } from '../store/teamListStore';

import { usePulseRefresh } from './usePulseRefresh';

/**
 * 团队清单的**常驻读面**：一次首拉 + 一个脉冲引擎。
 *
 * # 为什么需要它（侧栏常驻，面板不常驻）
 *
 * 清单原来是**面板**的读面（`useTeamList` 的「挂载即拉一次」）。侧栏团队行是常驻的：用户
 * 可能整场都不打开团队面板，而侧栏要显示「这台机器上有哪些队」。没有这个 owner，清单会一直
 * 停在「还没问到」—— 团队行一条都不出现，且没有任何报错。
 *
 * # 只有一个实现：`useTeamList` 也走它
 *
 * `useTeamList` = 本 hook（拉取 + 失效引擎）+ 按激活项目裁剪。把一个资源的两件事
 * （要不要拉 / 怎么失效）收在一处，面板与侧栏就不会各写一遍合并窗口与在飞排队
 * （`usePulseRefresh` 的职责）。
 *
 * # 接线点：能有两个读面，不能有第二套逻辑
 *
 * 面板的列表页与侧栏读的是同一份清单，两者都经**本 hook**（`useTeamList` = 本 hook + 按项目裁剪）。
 * 于是一个资源只有一套拉取 / 一套失效逻辑 —— 但它们同时挂载时确实是**两个脉冲引擎**
 * （`usePulseRefresh` 的引擎是每 hook 实例一份），一次脉冲因此最多发**两次** `team_list`。
 *
 * 这是有意接受的代价，也把上界写在这里：
 * - 同时存在的读面只有两个（侧栏的 `ProjectsPanel` 与单例 dock 视图 `TeamPanel`）；
 * - 清单是有界小载荷（≤ 50 行且无花名册 / 任务行），且两个引擎各自还会用 100ms 窗口
 *   合并同一次动作产生的多条脉冲；
 * - 乱序落地不会让界面回退：`teamListStore.refresh` 的代数守卫只接受最新一代的响应。
 *
 * 所以这里不做全局单飞（single-flight）：那个做法会让一个挂死的请求**永久堵死**后续刷新，
 * 而它换来的只是省一次小载荷。
 *
 * 失败不闪空、卡住的请求不堵住后续刷新等纪律都在 store（`teamListStore.refresh`
 * 的代数守卫）与 `usePulseRefresh`（合并窗口 / 在飞排队 / 卸载闩）里，本 hook 只做接线。
 */
export function useTeamListBootstrap(): void {
  // 清单面的脉冲水位：与快照面各一份（两块数据、两个读面）。
  const rev = useTeamListStore((s) => s.lastRev);

  // 挂载即拉一次：store 保留上一次成功的结果，所以这只是一次确认性的重取，不会闪空。
  useEffect(() => {
    void useTeamListStore.getState().refresh();
  }, []);

  /** 这就是清单的失效源：团队/成员/任务的任何写路径都会推一条脉冲。 */
  usePulseRefresh(useTeamListStore.getState().refresh, { rev });
}
