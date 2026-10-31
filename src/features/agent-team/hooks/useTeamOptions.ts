import { useCallback, useEffect, useRef, useState } from 'react';

import type { TeamOptions } from '@/shared/types/team';

import { fetchTeamOptions } from '../api/teamApi';
import { messageOf } from '../utils/errors';

/**
 * 团队配置面（`team_options`）：这个队允许谁当成员 / 上限 / 三个缺省值是什么。
 *
 * # 为什么面板的默认值只能来自这里
 *
 * 「默认 4 个成员、`shared` 工作区、`queue` 审批」这三件事的事实都在后端
 * （`types.rs::TeamConfig::default`）。在前端把它们写成常量就是**第二份默认值**：
 * 后端一改，面板仍在提交旧的缺省，而两份都自洽 —— 没有任何一处会报错。所以这个 hook
 * 拿不到数据时（`options === null`）面板**不允许建队**：不知道缺省值就不该替用户决定。
 *
 * # 与 `useLaunchableAgents` 的分工（不要合并成一个 hook）
 *
 * | hook | 命令 | 回答的问题 |
 * | --- | --- | --- |
 * | [`useLaunchableAgents`](./useLaunchableAgents.ts) | `team_launchable_agents` | 这台机器上**谁**能当成员（准入事实）|
 * | 本 hook | `team_options` | **这个队**允许谁、还能加几个、缺省是什么（配置经准入解析后的结果）|
 *
 * 两者的失败方式不同（一个是改配置、一个是换 CLI 或升级 Neeko），合成一个 hook 会让
 * 「配置为空」与「后端不可达」共用一条错误文案。
 *
 * # 三态分离与失败不清空
 *
 * 与 [`useLaunchableAgents`] 同一条纪律：`options === null && loading` = 还没问到、
 * `null && !loading` = 失败且从未成功、有内容 = 可渲染。重取失败保留上一次成功的值
 * （闪空比旧数据更糟），但 `error` 会一起显示出来。
 */

export interface TeamOptionsState {
  /** `null` = 还没拿到过配置（首次加载 / 失败且从未成功）—— 此时**不允许建队**。 */
  options: TeamOptions | null;
  loading: boolean;
  /** 最近一次失败的可读原因（`AppError` 原文）；`null` = 没有错误。 */
  error: string | null;
  /** 重新拉取（失败重试 / 用户改了 agent 配置后手动刷新）。 */
  reload: () => void;
}

export function useTeamOptions(teamId: string | null = null): TeamOptionsState {
  const [options, setOptions] = useState<TeamOptions | null>(null);
  /** 初值 `true`：本 hook 挂载即拉，第一帧事实上就在加载中（理由同 `useLaunchableAgents`）。 */
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /**
   * 代数守卫 + 卸载闩：面板在 dock 里反复挂载卸载，迟到的响应不许写进一个已不存在的组件，
   * 多次 `reload` 并发时也只允许最新一代落地。
   */
  const generation = useRef(0);

  const reload = useCallback(() => {
    const mine = ++generation.current;
    setLoading(true);
    void fetchTeamOptions(teamId)
      .then((next) => {
        if (mine !== generation.current) return;
        setOptions(next);
        setError(null);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (mine !== generation.current) return;
        // 不清空 options：见文件头「失败不清空」。
        setError(messageOf(err, 'Could not read the team configuration defaults'));
        setLoading(false);
      });
  }, [teamId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 挂载/信号驱动重拉（项目既有模式，见 useLaunchableAgents / useDiffData）
    reload();
    return () => {
      // 作废在飞响应。
      generation.current += 1;
    };
  }, [reload]);

  return { options, loading, error, reload };
}
