import { useCallback, useEffect, useRef, useState } from 'react';

import { useProjectStore } from '@/shared/store/projectStore';
import type { TeamList } from '@/shared/types/team';
import { invokeErrorMessage } from '@/shared/utils/invokeError';

import { fetchTeamList } from '../api/teamApi';

import { usePulseRefresh } from './usePulseRefresh';

/**
 * 团队清单（`team_list`）：**这台机器上**的团队，面板据此重开 / 关闭 / 只读查看。
 *
 * # 为什么面板需要它（而 `teamStore` 不够）
 *
 * `teamStore` 只知道**当前打开的那一个队**：app 重启后团队会从库里 hydrate 回来，但没有
 * 任何入口能把它们重新打开 —— 用户看到的是一块空面板，仿佛团队都没了。清单是那条入口的
 * 数据面，与「当前打开哪个队」是两件事，所以状态也分开：清单成功/失败**不能**清掉
 * `teamStore.snapshot`（那是另一个队的事实）。
 *
 * # 跟随项目（2026-11-08 用户裁决）
 *
 * 清单按 `activeProjectId` 过滤（后端 `list_teams_scoped`）：切项目 = 换一份清单。
 * `projectId` 在 `load` 的依赖里 —— 换项目自动重拉，不需要等脉冲。空 `project_id`
 * 的旧行（v16 之前）被后端排除 —— 它们无法归属到任何项目，显示在「全部」里反而
 * 让用户以为它们属于当前项目。
 *
 * # 三态分离（与 `useTeamOptions` 同一条纪律）
 *
 * | 状态 | 含义 | 面板 |
 * | --- | --- | --- |
 * | `list === null && loading` | 还没问到 | 「正在加载…」（**不**显示空态）|
 * | `list === null && !loading` | 失败且从未成功 | 错误原文 + 重试 |
 * | `list.teams === []` | 后端确实一个队都没有 | 「还没有团队，先以队长身份开一个」|
 *
 * 加载中显示空态会让人以为「团队都没了」—— 而真相是「还没问到」。
 *
 * # 失败不清空
 *
 * 重取失败保留上一次成功的清单（同 `teamStore.snapshot`）：闪空比旧数据更糟，
 * 而行上的状态徽标本来就来自后端，旧一点仍然对得上一分钟前的现实。
 */

export interface TeamListState {
  /** `null` = 还没拿到过清单（首次加载 / 失败且从未成功）。 */
  list: TeamList | null;
  loading: boolean;
  /** 最近一次失败的可读原因（`AppError` 原文）；`null` = 没有错误。 */
  error: string | null;
  /** 重新拉取（失败重试 / 列表页的「刷新」/ 关闭团队之后）。 */
  reload: () => void;
}

export function useTeamList(): TeamListState {
  // 「跟随项目」：清单只显示激活项目下的团队。projectId 变化 = 失效源之一
  // （load 的依赖里有它 → 重拉；切项目后第一次脉冲前就是新项目的清单）。
  const projectId = useProjectStore((s) => s.activeProjectId);
  const [list, setList] = useState<TeamList | null>(null);
  /** 初值 `true`：本 hook 挂载即拉，第一帧事实上就在加载中（理由同 `useLaunchableAgents`）。 */
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /** 代数守卫 + 卸载闩：面板在 dock 里反复挂载卸载，迟到的响应不许写进已不存在的组件。 */
  const generation = useRef(0);

  /**
   * 拉一次（**返回 Promise**：合并窗口要靠它知道「这一拉什么时候落地」）。
   *
   * 返回 `Promise<void>` 而不是 `void` 是 [usePulseRefresh] 的契约要求：在飞期间又来的脉冲
   * 只能**排一个待办**，落地后再补一次；拿不到落地时刻就只能并发发起，最后一条变化会被乱序
   * 响应盖掉。
   */
  const load = useCallback(async (): Promise<void> => {
    const mine = ++generation.current;
    setLoading(true);
    try {
      const next = await fetchTeamList(projectId);
      if (mine !== generation.current) return;
      setList(next);
      setError(null);
    } catch (err: unknown) {
      if (mine !== generation.current) return;
      // 不清空 list：见文件头「失败不清空」。
      setError(invokeErrorMessage(err, 'Could not list the teams on this machine'));
    } finally {
      if (mine === generation.current) setLoading(false);
    }
  }, [projectId]);

  const reload = useCallback(() => {
    // 按钮 / 宿主的入口只要「开始拉」，不关心落地（`onSettled` 之类的回调链不 await 它）。
    void load();
  }, [load]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 挂载/信号驱动重拉（项目既有模式，见 useLaunchableAgents / useTeamOptions）
    void load();
    return () => {
      // 作废在飞响应。
      generation.current += 1;
    };
  }, [load]);

  /**
   * 脉冲 → 重取清单。
   *
   * **这就是本 hook 的失效源**（修之前它一个都没有）：团队/成员/任务的任何写路径都会推一条
   * 脉冲，而在**列表态**下 `teamStore.teamId` 恰好是 `null` —— 那时曾经整块订阅被关掉，
   * 于是「建了队、按了返回列表，看到的还是建队前的清单」。
   *
   * 列表与快照是**两块**数据面（一个问「这台机器上有哪些队」，一个问「这个队长什么样」），
   * 所以各自声明自己的刷新函数：同一个脉冲同时唤醒两块，各拉各的。
   */
  usePulseRefresh(load);

  return { list, loading, error, reload };
}
