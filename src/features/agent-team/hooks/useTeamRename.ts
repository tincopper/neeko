import { useCallback } from 'react';

import { invokeErrorMessage } from '@/shared/utils/invokeError';

import { renameTeam as renameTeamCommand } from '../api/teamApi';

/**
 * 改团队名的**执行**部分：`team_rename` → 成败都让宿主重取列表。
 *
 * # 为什么没有「在飞」闸门、没有按行的 busy
 *
 * 改名是**行内同步**的动作：输入框在提交的那一刻就卸了（`TeamListRow` 的编辑态生命周期
 * 就是那个 `<InlineRenameInput>` 的挂载期），用户没有第二次点击的机会。再加一个
 * `renamingTeamId` 只会让「哪一行正在改」变成一个没人消费的状态。
 *
 * # 为什么不做乐观更新
 *
 * 名字的真相是 `team_list`（后端一行），不是本 hook 手里的一份草稿。先改本地再回滚，会让
 * 「失败」这一帧长得与成功一样（除了 toast）—— 而失败时用户要能确定名字**没**改成。
 *
 * # 失败只报后端原文（不另起横幅）
 *
 * 关闭 / 删除的错误是**面板级**的（团队停在 `closing` 这种状态必须看得见），所以它们进
 * `TeamPanelErrors`。改名失败不会留下任何异常状态：列表还是旧名字，重来一次即可 ——
 * 一条 toast 足够，多一条常驻横幅只是噪音。
 */
export interface RenameTeamOptions {
  onShowToast?: (message: string, type?: 'info' | 'error') => void;
  /**
   * **成功**改名后的跨域落点（宿主把已打开的 tab 标题跟上）。
   *
   * 只在成功时调：失败什么都没改，去重写 tab 标题等于把「没改成」画成「改成了」。
   * 改名是后端的一行事实，而 tab 标题是它在**另一个域**的投影 —— 投影不追，症状是
   * 「列表叫新名字，tab 上还写着队长 · 旧名字」。
   */
  onRenamed?: (teamId: string, name: string) => void;
  /** 一次改名落地后的通知（**成败都发**：失败也要重取，后端原文可能与现实不一致）。 */
  onSettled?: () => void;
}

export interface RenameTeamState {
  /**
   * 改一个团队的名字。
   *
   * @param teamId 要改的团队。
   * @param name 新名字（两端空白与合规性由后端判；空名 / 控制字符 / 超预算会被拒，
   *             前端只负责不发必然失败的请求）。
   *
   * 返回 `void`（不是 `Promise<boolean>`）：两个入口（列表行 / 面板头）都不消费结果 ——
   * 名字的真相经 `onSettled` 重取回到界面，失败经 toast 呈现。把结果也回传就等于让调用方
   * 可以选择「相信它」，而那份相信是第三份事实。
   */
  rename: (teamId: string, name: string) => void;
}

export function useTeamRename(options: RenameTeamOptions = {}): RenameTeamState {
  const { onShowToast, onRenamed, onSettled } = options;

  const rename = useCallback(
    async (teamId: string, name: string): Promise<void> => {
      try {
        await renameTeamCommand(teamId, name);
        // 先把**已打开的 tab** 跟上（本地同步、无 I/O），再让宿主重取列表。
        onRenamed?.(teamId, name);
      } catch (err) {
        // 后端原文（`InvalidInput` / `NotFound`）：不翻译、不改写。
        onShowToast?.(invokeErrorMessage(err, `Could not rename team ${teamId}`), 'error');
      } finally {
        // 成败都重取：失败时用户要能确认列表还是旧名字（本地不做乐观更新）。
        onSettled?.();
      }
    },
    [onShowToast, onRenamed, onSettled],
  );

  return { rename };
}
