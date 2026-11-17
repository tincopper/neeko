import { useCallback } from 'react';

import { useTeamStore } from '../store/teamStore';
import { resumedTerminalTarget } from '../utils/memberTerminal';

import { useTeamResume } from './useTeamResume';

/**
 * 面板级的**恢复**组合点：一个在飞闸门 + 两个入口（整队 / 单成员）+ 成员级的落点。
 *
 * # 为什么收窄成两个无参（或单参）回调
 *
 * `useTeamResume::resume(teamId, memberId)` 要调用方自己带上「我现在在看哪个队」。
 * 三个入口（头部 / 花名册行 / 抽屉）各自拼一次就会各自拼错一次 —— 而拼错的症状是
 * 「恢复到了另一个队」。所以 `teamId` 在这里绑定一次（`showingTeamId`），调用方只说
 * **恢复谁**（`null` = 整队）。与 `useTeamCrossDomainCallbacks` 的「落键点唯一」同一纪律。
 *
 * # 为什么在飞闸门必须是面板级的
 *
 * 整队恢复与成员恢复走**同一个命令**（`team_resume`），一次整队恢复会顺带起多个进程。
 * 两个入口各持一个 `resuming` 会让用户在整队恢复的中途点某个成员行 —— 那时命令会看到
 * 已 live 的成员并跳过它们，看起来「什么都没发生」。一个闸门（`useTeamResume` 里的
 * 重入判据）比两条互相看不见的状态便宜。
 *
 * # 「恢复会话 = 打开会话」只对**成员级**成立
 *
 * 成员级恢复是用户指着一个成员说「把我带回去」：起新进程只是手段，落点是**他那个终端**。
 * 所以成功之后这里直接把新 PTY 交出去，用户不必再点一次那个已经变成「打开会话」的按钮。
 *
 * 整队恢复**不**这么做：4 人队会同时起 4 个进程，再自动开 4 个 tab 就把用户眼前那一屏换掉
 * 了（而他刚才在看什么已经不重要了）。它只回答「几个回来了」，开哪个由用户自己按 —— 那时
 * 那些行已经是「打开会话」了。
 *
 * # 落点为什么也在这里，而不是在组件里
 *
 * 它需要三样东西同时成立：**刷新已落地**的快照（新 `terminalId` 是后端在这次恢复里新铸的）、
 * 「要开谁」的唯一判据（`resumedTerminalTarget`，与花名册取句柄同口径）、以及宿主的
 * `onOpenTerminal` 连线。分散到 `TeamPanel` 会让「一次恢复」横跨组件与 hook 两层，而中间
 * 任何一步漏掉（例如忘了 await 刷新）都只是静默地少开一个 tab。
 */
interface UseTeamResumePanelOptions {
  /** 当前打开的团队（`null` = 列表态：两个入口都不该被渲染，这里再兜一层）。 */
  showingTeamId: string | null;
  onShowToast?: (message: string, type?: 'info' | 'error') => void;
  /**
   * 重取团队快照（`teamStore.refresh`）。**会被 await**。
   *
   * 必须 await：成员行上的 `terminalId` 在恢复之前是 `null`，拿恢复前的快照去找句柄只会
   * 得到「没有可接管的东西」—— 症状是「起了进程，屏幕上什么都没变」。
   */
  refreshSnapshot: () => Promise<void>;
  /** 重取团队清单（列表行的徽标也变了）。成败都调，不 await。 */
  reloadList: () => void;
  /**
   * 成员级恢复成功后的落点：把新起的 PTY 接进 dock（`undefined` = 宿主未注入这条连线）。
   *
   * 只在 `report.resumed` 含这个成员时调用：`cold` / `failed` 的成员没有新进程，
   * 去接管只会得到一次空点击。
   */
  onOpenTerminal?: (terminalId: string, title: string, agentId: string | undefined) => void;
}

interface TeamResumePanel {
  /** 有一次恢复在飞（两个入口共用，按钮据此置灰）。 */
  resuming: boolean;
  /** 后端原文（`sealed` / `closing` 的理由原样显示，不做本地改写）。 */
  resumeError: string | null;
  /** 整队恢复（`memberId = null`）。 */
  resumeTeam: () => void;
  /** 只恢复一名成员，成功时接管它新起的那个 PTY。 */
  resumeMember: (memberId: string) => void;
}

export function useTeamResumePanel({
  showingTeamId,
  onShowToast,
  refreshSnapshot,
  reloadList,
  onOpenTerminal,
}: UseTeamResumePanelOptions): TeamResumePanel {
  /**
   * 一次恢复落地：快照与列表都重取（活跃性 / 徽标都变了）。
   *
   * 成败都调 —— 失败也可能已经改了别的成员。`refreshSnapshot` 被 await（理由见选项文档），
   * 它决定了成员级落点能不能找到那个新句柄。
   */
  const handleSettled = useCallback(async () => {
    await refreshSnapshot();
    reloadList();
  }, [refreshSnapshot, reloadList]);

  /**
   * 恢复成功 ⇒ 把用户带到它**新起**的那个 PTY。
   *
   * 句柄从 store 的**当下**快照取（`getState()`），不读渲染期的 `snapshot`：调用发生在
   * `await refreshSnapshot()` 之后，两者在同一个 tick 里是不同代。判据只读结果
   * （[`resumedTerminalTarget`]），这里不做任何二次推导。
   */
  const handleMemberResumed = useCallback(
    (memberId: string) => {
      if (onOpenTerminal === undefined) return;
      const members = useTeamStore.getState().snapshot?.members ?? [];
      const target = resumedTerminalTarget(members, memberId);
      // 没有句柄（`cold` / `failed` / 快照滞后）就什么都不开 —— 不拿旧 id、不降级成历史。
      if (target === null) return;
      onOpenTerminal(target.terminalId, target.title, target.agentId);
    },
    [onOpenTerminal],
  );

  const { resuming, resumeError, resume } = useTeamResume({
    onShowToast,
    onSettled: handleSettled,
  });

  const resumeTeam = useCallback(() => {
    if (showingTeamId === null) return;
    // `null`（不是省略）= 整队：与其它写命令同一口径（见 `api/teamApi.ts::resumeTeam`）。
    // 整队恢复不接管终端（见文件头）。
    void resume(showingTeamId, null);
  }, [resume, showingTeamId]);

  /**
   * 只恢复一名成员，并在**真的**起来了之后把用户带到它那个终端。
   *
   * 报告是事实判据：`cold` / `failed` 的成员落不进 `resumed`，它们没有新进程可开。
   */
  const resumeMember = useCallback(
    async (memberId: string) => {
      if (showingTeamId === null) return;
      const report = await resume(showingTeamId, memberId);
      // `null` = 失败 / 被闸门忽略：没有「该开谁」这个答案。
      if (report === null || !report.resumed.includes(memberId)) return;
      handleMemberResumed(memberId);
    },
    [resume, showingTeamId, handleMemberResumed],
  );

  return { resuming, resumeError, resumeTeam, resumeMember };
}
