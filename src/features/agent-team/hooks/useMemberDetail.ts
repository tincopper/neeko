import { useCallback, useEffect, useRef, useState } from 'react';

import type { MemberDetail } from '@/shared/types/team';
import { invokeErrorMessage } from '@/shared/utils/invokeError';

import { fetchMemberDetail } from '../api/teamApi';

import { usePulseRefresh } from './usePulseRefresh';

/**
 * 成员详情（`team_member_detail`）—— 抽屉的数据面。
 *
 * # 为什么不放进 `teamStore`
 *
 * `teamStore` 持有的是「面板一直在看的那份快照」。成员详情是**一次点击**的产物：它带任务行
 * 与 50 条事件，而这个成员可能三秒后就被关掉抽屉不再看。放进全局 store 就要在关闭时清理、
 * 在换队时作废、在任何一次脉冲上判断「这个 id 还在不在」—— 三条都是本 hook 已经在做的事，
 * 只是换了个地方写。面板已经有一个同样的先例（`useTeamList`：也是「只属于一块 UI」的数据）。
 *
 * # 三条判据
 *
 * 1. **`memberId === null` 不发请求**（且不保留上一个成员的数据 —— 否则抽屉换人时先显示
 *    另一个人的任务，那是把 B 的租约写成 A 的）。
 * 2. **脉冲驱动重取**：走共享的 [`usePulseRefresh`]（与列表、快照**同一份**实现）。租约、
 *    任务、事件都会在别人的写里变，而成员详情**没有**自己的事件流 —— 它只能跟着团队脉冲走。
 * 3. **失败不清数据**：`detail` 保留上一次成功的值，错误另外可见（闪空比旧数据更糟，
 *    同 `teamStore.refresh` / `useTeamList`）。
 *
 * # 为什么上限不在这里再截一刀
 *
 * `tasks` / `events` 的上界在后端（`view.rs`）。前端再 `slice` 一次就是第二个上界，
 * 而它会在后端常量变化时说出一个后端并没用过的数字（同 `utils/taskBoard` 的 `MAX_BOARD_TASKS`
 * 只用于文案的理由）。
 */

export interface MemberDetailState {
  /** `null` = 还没拿到过（未打开 / 首次加载中 / 换人 / 失败且从未成功）。 */
  detail: MemberDetail | null;
  /** 是否有请求在飞（保留着上一次数据时也置 `true` —— 抽屉可以显示「刷新中」）。 */
  loading: boolean;
  /** 最近一次失败的可读原因；`null` = 没有错误。 */
  error: string | null;
  /** 手动重取（错误条上的「重试」）。 */
  reload: () => void;
}

/** 一份数据 + 它是**哪个成员**的（换人时不许把 A 的任务当成 B 的）。 */
interface Loaded {
  memberId: string;
  detail: MemberDetail;
}

export function useMemberDetail(memberId: string | null): MemberDetailState {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * 代数守卫：抽屉关闭 / 换人 / 新一轮脉冲都会作废在飞响应。
   *
   * 与 `teamStore` 的 `detailRequest` 同一条纪律 —— 迟到的响应不许把抽屉又填上一个人。
   */
  const generation = useRef(0);

  /** 拉一次（返回 Promise：合并窗口据此判断「这一拉何时落地」，见 `usePulseRefresh`）。 */
  const load = useCallback(async (target: string): Promise<void> => {
    const mine = ++generation.current;
    setLoading(true);
    try {
      const next = await fetchMemberDetail(target);
      if (mine !== generation.current) return;
      setLoaded({ memberId: target, detail: next });
      setError(null);
    } catch (err: unknown) {
      if (mine !== generation.current) return;
      // 不清 `loaded`：见文件头第 3 条。
      setError(invokeErrorMessage(err, `Could not load member ${target}`));
    } finally {
      if (mine === generation.current) setLoading(false);
    }
  }, []);

  const reload = useCallback(() => {
    if (memberId === null) return;
    void load(memberId);
  }, [load, memberId]);

  useEffect(() => {
    if (memberId === null) {
      // 关闭抽屉：作废在飞响应 + 清掉旧成员的数据（否则下次打开会先闪另一个人的名册）。
      generation.current += 1;
      // eslint-disable-next-line react-hooks/set-state-in-effect -- 复位是「没有目标」这个输入的直接结果（项目既有模式，见 useTeamList）
      setLoaded(null);
      setError(null);
      setLoading(false);
      return undefined;
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 换人驱动重取（项目既有模式，见 useTeamList）
    void load(memberId);
    // 卸载 / 换人：作废这一次的在飞响应（迟到的响应不许写进已经不在的抽屉）。
    return () => {
      generation.current += 1;
    };
  }, [load, memberId]);

  /**
   * 脉冲 → 重取。成员详情**没有**自己的事件流：租约、任务、事件都会在别人的写里变，
   * 所以它只能跟着团队脉冲走。合并窗口 / 在飞排队 / 卸载闩由 [`usePulseRefresh`] 统一实现
   * （修之前这里是「`rev` 变一次就立刻拉一次」，与另外两块的时机语义不一致）。
   *
   * 抽屉关着时（`memberId === null`）不参与：没有目标就没有可刷新的东西。
   */
  usePulseRefresh(
    useCallback(() => (memberId === null ? undefined : load(memberId)), [load, memberId]),
    { enabled: memberId !== null },
  );

  return {
    // `loaded.memberId !== memberId` 的那一帧（换人后的第一次渲染）必须返回 `null`：
    // 否则抽屉会把上一个成员的任务挂在新的名字下面。
    detail: loaded !== null && loaded.memberId === memberId ? loaded.detail : null,
    loading,
    error,
    reload,
  };
}
