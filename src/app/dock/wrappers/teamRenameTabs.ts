import { useEditorStore } from '@/shared/store/editorStore';
import type { TabData } from '@/shared/types/tab';
import { leaderTerminalTabTitle, teamBoardTabTitle } from '@/shared/utils/teamTabTitles';

/**
 * 团队改名后，把**已经打开的 tab** 标题跟上（改名这条动作在 tab 域的投影）。
 *
 * # 判据只读 tab 自己的地址，不读环境
 *
 * 投影要回答两件事：「哪些 tab 属于这支队」「其中哪一个是队长终端」。两者都从**tab 自己**
 * 回答，不从「当前在看哪个队 / 哪个工作区」推断：
 *
 * | tab | 靠什么认 |
 * | --- | --- |
 * | 看板 / 分配图 | `data.teamId` —— 它就是那个 tab 的地址 |
 * | 队长终端 | `data.ptySessionId` 与快照里队长的句柄相等（PTY id 由后端全局铸造，跨 tab 唯一）|
 *
 * 这两条曾经是从环境推出来的：`teamStore.snapshot`（**上一个打开过的队**的快照 —— 列表态
 * 改名时它根本不是这支队）与 `activeWorkspaceSession(projectId)`（**改名那一刻**的工作区 ——
 * 用户切过工作树就不是 tab 所在的那个）。两者都只在「环境恰好等于事实」时成立，症状分别是
 * 「改 A 的名，B 的队长 tab 变成了 A 的新名字」与「切过工作树后改名，tab 上的旧名字留着」。
 *
 * 所以这里扫**全部 tab 空间键**：tab 的地址已经写在 `data` 里，不需要再从环境推一个。
 * 空间键只用于写回（`updateTab(key, …)`），**不参与判定** —— 这也是它比「先算出应该落在哪个
 * key」更稳的原因：`(projectId, worktreePath)` 的派生点只有一个（`session.key`），消费侧
 * 再来一次就是在猜第二份。
 *
 * # 三条判据
 *
 * 1. **队长终端靠 `ptySessionId` 认**，不靠标题字符串：标题正是要被重写的东西，拿它当判据
 *    等于用结果找结果（而且改过名的 tab 就再也匹配不上）。句柄来自团队快照里队长的
 *    `session.terminalId`；队长进程不在（`null`）时**一个终端都不碰** —— 猜一个只会改错行。
 * 2. **看板 tab 只认 `data.teamId`**：同一台机器上有多个队，别的队那一屏不跟着变。
 * 3. **`data.teamName` 一起写**：它不是渲染用的副本 —— 看板 tab 重新打开 / 去重、
 *    以及宿主展示都读它，只改 `title` 会留下「标题新、数据旧」的两份事实。
 */
export interface RetitleTeamTabsInput {
  /** 被改名的团队。 */
  teamId: string;
  /** 新名字（已裁掉两端空白）。 */
  teamName: string;
  /** 队长 PTY 的会话 id（快照里队长成员的 `session.terminalId`）；`null` = 队长进程不在。 */
  leaderTerminalId: string | null;
}

/** 一次写回：空间键只在写回时用到（判定阶段不看它）。 */
interface TabRetitle {
  key: string;
  tabId: string;
  partial: Partial<TabData> & { title?: string };
}

/**
 * 收集后统一写回：`updateTab` 会替换 store 里的 tab 数组，边遍历边写会让「表里正在迭代的
 * 那一份」与「刚写进去的那一份」混在一起 —— 先算清楚要改什么，再一次性落地。
 */
export function retitleTeamTabs(input: RetitleTeamTabsInput): void {
  const state = useEditorStore.getState();
  const updates: TabRetitle[] = [];

  for (const [key, slot] of Object.entries(state.tabs)) {
    for (const tab of slot.tabs) {
      if (tab.data.kind === 'team-board') {
        if (tab.data.teamId !== input.teamId) continue;
        updates.push({
          key,
          tabId: tab.id,
          partial: {
            kind: 'team-board',
            teamName: input.teamName,
            title: teamBoardTabTitle(input.teamName),
          },
        });
        continue;
      }
      if (tab.data.kind !== 'terminal') continue;
      if (input.leaderTerminalId === null) continue;
      if (tab.data.ptySessionId !== input.leaderTerminalId) continue;
      updates.push({
        key,
        tabId: tab.id,
        partial: { title: leaderTerminalTabTitle(input.teamName) },
      });
    }
  }

  for (const update of updates) {
    state.updateTab(update.key, update.tabId, update.partial);
  }
}
