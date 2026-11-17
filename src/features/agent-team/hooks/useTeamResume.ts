import { useCallback, useRef, useState } from 'react';

import type { TeamResumeReport } from '@/shared/types/team';
import { invokeErrorMessage } from '@/shared/utils/invokeError';

import { resumeTeam as resumeTeamCommand } from '../api/teamApi';
import { describeResumeReport } from '../utils/resumeReport';

/**
 * 恢复团队 / 成员的**执行**部分：`team_resume` → 一句话结果 + 交给宿主重取。
 *
 * # 为什么它不持有任何成员状态（红线 17）
 *
 * 「谁可恢复 / 谁还活着」来自快照（`MemberStatusView.session` / `resumable`）。本 hook 只记
 * 两件**自己发起**的事：有没有一次恢复在飞、上一次失败的后端原文。这两件都是「我请求过
 * 什么」的本地记账，不是对方状态的镜像 —— 成功之后成员的活性由重取的快照回答。
 *
 * # 为什么失败也要 `onSettled`
 *
 * `team_resume` 失败有两种：整次 `Conflict`（团队 sealed / closing / 端点没起来）与逐成员
 * `failed`（一个成员起不来，其他照常）。两种都意味着**事实可能已经变了**（例如后端在失败前
 * 已经恢复了别的成员），面板的状态必须重取；不重取就会拿一份过时的快照继续渲染。
 *
 * # 为什么成功用一句话而不是逐个成员弹提示
 *
 * 整队恢复会一次起 N 个进程。N 条 toast 会把屏幕刷满而且只存在两秒；而「恢复了几个、几个
 * 只能新开、谁失败了」恰好是一句话能装下的 —— 装不下时那句里也点了名（见 `resumeReport`）。
 *
 * # 为什么报告也**回给调用方**（不只是变成一句话）
 *
 * 「恢复会话 = 打开会话」需要知道这一次**真的起来了谁**：`resumed` 里的成员才有新 PTY
 * 可接管。从 toast 那句话反推是不可能的（那是给人读的句子），所以在同一份报告上多给一个
 * 出口。
 *
 * # 一次只编排一个恢复（入口共用一个实例）
 *
 * 恢复的入口有两个（头部的整队、花名册 / 抽屉的成员级），它们共用 TeamPanel 里**同一个**
 * hook 实例。「在飞」因此是面板级的事实，不是某个按钮的本地状态：在飞期间再调一次 `resume`
 * 会被忽略（而不是起第二个编排 —— 两个恢复同时对同一批成员发 `team_resume`，后端的幂等
 * 判据与前端看到的报告会打架）。忽略而不是排队：恢复是用户主动动作，落地后重按一次即可。
 */
export interface ResumeTeamOptions {
  onShowToast?: (message: string, type?: 'info' | 'error') => void;
  /**
   * 一次恢复请求落地后的通知（**成败都发**）：让宿主持有的快照 / 清单重取。
   *
   * 返回 Promise 时会被 **await**：恢复之后要接管的 `terminalId` 是后端这次新铸的，只
   * 存在于重取后的快照里。不 await 就让调用方去拿句柄，它看到的是上一条快照（那时成员
   * 还没活）—— 「恢复会话 = 打开会话」会静默地退化成「起了一个进程，屏幕上什么都没变」。
   */
  onSettled?: () => void | Promise<void>;
}

export interface ResumeTeamState {
  /** 有恢复在飞（成员级与整队级共用；在飞期间新的恢复请求被忽略）。 */
  resuming: boolean;
  /**
   * 最近一次失败的后端原文（`AppError` 的可读字符串）。
   *
   * **不加工**：`Conflict` 里写着「这个队已封存 / 正在关闭」的具体理由，前端换一句话就把
   * 唯一能行动的信息丢了。
   */
  resumeError: string | null;
  /**
   * 恢复（`memberId` 缺省 = 整队）。
   *
   * 从不向调用方抛错（面板的事件处理器里抛错只会变成 unhandled rejection）：失败通过
   * `resumeError` + toast 呈现，成功通过 toast 呈现。在飞期间调用是**无操作**（见文件头）。
   *
   * @returns 这次恢复的报告（四个桶）；**失败 / 被在飞闸门忽略 ⇒ `null`** ——
   *          两者都没有「该接管谁的终端」这个答案，调用方不得从 `null` 推导任何东西。
   *          交回报告时 `onSettled`（若有）已 await 完毕，所以快照已经是恢复之后的。
   */
  resume: (teamId: string, memberId?: string | null) => Promise<TeamResumeReport | null>;
}

export function useTeamResume(options: ResumeTeamOptions = {}): ResumeTeamState {
  const { onShowToast, onSettled } = options;
  const [resuming, setResuming] = useState(false);
  const [resumeError, setResumeError] = useState<string | null>(null);
  /**
   * 在飞闸门。
   *
   * 用 ref 而不是读 `resuming` 状态：同一 tick 里的两次点击都还没看到重新渲染后的
   * `resuming`，只看状态会让两道请求都发出去（经典的双击竞态）。闸门与状态因此是**两件**
   * 事：闸门保证只有一个编排，`resuming` 只负责把这件事画出来。
   */
  const inflight = useRef(false);

  const resume = useCallback(
    async (teamId: string, memberId?: string | null): Promise<TeamResumeReport | null> => {
      if (inflight.current) return null;
      inflight.current = true;
      setResuming(true);
      setResumeError(null);
      let report: TeamResumeReport | null = null;
      try {
        report = await resumeTeamCommand(teamId, memberId);
        // 报告 → 一句话：四个桶都可能非空，只报 `resumed.length` 会把「3 个只能新开」藏起来。
        onShowToast?.(describeResumeReport(report), 'info');
      } catch (err) {
        const message = invokeErrorMessage(err, `Could not resume team ${teamId}`);
        setResumeError(message);
        onShowToast?.(message, 'error');
      } finally {
        inflight.current = false;
        setResuming(false);
        // 成败都通知宿主重取：失败也可能已经改了别的成员。
        // `await`：报告里的成员刚起进程，新 `terminalId` 只在重取后的快照里。
        await onSettled?.();
      }
      // 失败时 `report` 仍是 `null`（try 里没赋值成功）—— 失败没有「该开谁」这个答案。
      return report;
    },
    [onShowToast, onSettled],
  );

  return { resuming, resumeError, resume };
}
