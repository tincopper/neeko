import { useCallback, useEffect, useRef, useState } from 'react';

import type { LaunchableAgent } from '@/shared/types/team';

import { fetchLaunchableAgents } from '../api/teamApi';
import { messageOf } from '../utils/errors';

/**
 * 队长入口的**能力面**（`team_launchable_agents`）。
 *
 * # 为什么候选清单要过 IPC 而不是在前端筛
 *
 * 「这个 CLI 能不能起来」是后端 `admission.rs` 的判据（技能面 × MCP 注入档 × 凭证路），
 * 与 `start_team_session` / `team_spawn` 的拒绝**同一份**纯函数。前端自己筛一遍
 * （`enabled` 且 `command` 非空 —— 看起来最无害的那种）就是第二套判据：
 * 后端判据一变，面板仍按老规则放行，用户点到的必然是失败（prd R0.4 的反面）。
 *
 * # 三态必须分开（`null` / `[]` / 有内容）
 *
 * | 状态 | 含义 | 面板 |
 * | --- | --- | --- |
 * | `agents === null && loading` | 还没问到 | 「正在检查…」 |
 * | `agents === []` | 后端确实一个 CLI 都没有 | 明确空态（不是空下拉） |
 * | 有内容 | 逐行渲染可启动 / 被拒 + 理由 | 选择器 |
 *
 * `null` 与 `[]` 混用会让首次渲染闪一下「没有可用的 CLI」——那是**后端不可达**与
 * **配置为空**两件不同的事，混在一起后用户看到的提示永远是错的那个。
 *
 * # 失败不清空
 *
 * 重取失败保留上一次成功的清单（同 `teamStore` 的 `snapshot` 语义）：闪空比旧数据更糟，
 * 理由文字仍然对得上，只是可能已经过时 —— 面板会显示 `error`。
 */

export interface LaunchableAgentsState {
  /** `null` = 还没拿到过清单（首次加载 / 失败且从未成功）。 */
  agents: LaunchableAgent[] | null;
  loading: boolean;
  /** 最近一次失败的可读原因（`AppError` 原文）；`null` = 没有错误。 */
  error: string | null;
  /** 重新拉取（失败重试 / 用户改了 agent 配置后手动刷新）。 */
  reload: () => void;
}

export function useLaunchableAgents(): LaunchableAgentsState {
  const [agents, setAgents] = useState<LaunchableAgent[] | null>(null);
  /**
   * 初值 `true`：本 hook 挂载即拉，首次渲染那一刻事实上就在加载中。
   * 初值写 `false` 会让第一帧渲染出「拿不到清单」——一句**假**的错误提示，
   * 然后在 effect 里立刻被改成「正在检查…」（闪一下错话比多一个初始值更糟）。
   */
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /**
   * 代数守卫 + 卸载闩。
   *
   * 面板在 dock 里会被反复挂载/卸载，而 `invoke` 是一次往返：没有闩的话，
   * 卸载之后落地的响应会写进一个已经不存在的组件（React 会警告，且下次挂载可能
   * 拿到上一次的陈旧结果）。多次 `reload` 并发时也只允许最新一代落地。
   */
  const generation = useRef(0);

  const reload = useCallback(() => {
    const mine = ++generation.current;
    setLoading(true);
    void fetchLaunchableAgents()
      .then((rows) => {
        if (mine !== generation.current) return;
        setAgents(rows);
        setError(null);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (mine !== generation.current) return;
        // 不清空 agents：见文件头「失败不清空」。
        setError(messageOf(err, 'Could not read the launch capability of the configured CLIs'));
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 挂载/信号驱动重拉（项目既有模式，见 useDiffData / useStashList）
    reload();
    return () => {
      // 作废在飞响应。
      generation.current += 1;
    };
  }, [reload]);

  return { agents, loading, error, reload };
}
