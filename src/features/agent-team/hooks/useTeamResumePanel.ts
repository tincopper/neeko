import { useCallback } from 'react';

import { useTeamResume } from './useTeamResume';

/**
 * 面板级的**恢复**组合点：一个在飞闸门 + 两个入口（整队 / 单成员）。
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
 */
interface UseTeamResumePanelOptions {
  /** 当前打开的团队（`null` = 列表态：两个入口都不该被渲染，这里再兜一层）。 */
  showingTeamId: string | null;
  onShowToast?: (message: string, type?: 'info' | 'error') => void;
  /** 一次恢复结束后（成败都调）：快照与列表都要重取（活性 / 徽标都变了）。 */
  onSettled: () => void;
}

interface TeamResumePanel {
  /** 有一次恢复在飞（两个入口共用，按钮据此置灰）。 */
  resuming: boolean;
  /** 后端原文（`sealed` / `closing` 的理由原样显示，不做本地改写）。 */
  resumeError: string | null;
  /** 整队恢复（`memberId = null`）。 */
  resumeTeam: () => void;
  /** 只恢复一名成员。 */
  resumeMember: (memberId: string) => void;
}

export function useTeamResumePanel({
  showingTeamId,
  onShowToast,
  onSettled,
}: UseTeamResumePanelOptions): TeamResumePanel {
  const { resuming, resumeError, resume } = useTeamResume({ onShowToast, onSettled });

  const resumeTeam = useCallback(() => {
    if (showingTeamId === null) return;
    // `null`（不是省略）= 整队：与其它写命令同一口径（见 `api/teamApi.ts::resumeTeam`）。
    void resume(showingTeamId, null);
  }, [resume, showingTeamId]);

  const resumeMember = useCallback(
    (memberId: string) => {
      if (showingTeamId === null) return;
      void resume(showingTeamId, memberId);
    },
    [resume, showingTeamId],
  );

  return { resuming, resumeError, resumeTeam, resumeMember };
}
