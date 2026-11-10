import type { MemberStatusView } from '@/shared/types/team';

/**
 * 「打开会话」这个动作的**唯一**判据。
 *
 * # 为什么它是纯函数而不是按钮里的 `disabled={!member.terminalId}`
 *
 * 置灰本身**不构成理由**：用户看到一个不可点的按钮，唯一能得到的解释是悬停提示，
 * 而 `disabled` 元素不可聚焦 —— 键盘用户、读屏用户、以及「手指点上去什么都没发生」的人都
 * 拿不到那行 `title`。所以「能不能开」与「为什么不能开」必须一起产出，理由还要由调用方
 * 渲染成**可见文字**（见 `RosterRow`）。
 *
 * 判据只有一条：`terminalId != null`。成员是 Neeko 起的 PTY，会话 id 只在团队域里
 * （红线 12：不许从路径 / 名字拼）；`null` = 现在没有可接管的终端（没起来 / 起失败 /
 * 已关掉）。「有 id 但会话已死」不在这里预判 —— 那种情况点下去会得到终端的可读错误。
 *
 * # 文案为什么说「暂无会话」而不是「无进程」
 *
 * `terminalId === null` 只在说「这个成员此刻没有可打开的终端」，而**不等于**「它没有进程」：
 * 将来接 Chat 类成员（`channel = 'mcp'`，本来就没有 PTY）时，它们会走到这同一条分支 ——
 * 那时「无进程」会是一句错话（进程在跑，只是没有终端）。
 *
 * 扩展点：如果 Chat 成员需要不同的动作（比如「打开对话」而不是「打开会话」），判据的输入要
 * 从 `terminalId` 换成 `channel` + `terminalId` 两个字段，文案也要分叉；在那一刻之前保持
 * 中性措辞，不要在这里抢先写一种假设。
 */
export interface OpenTerminalAction {
  /** 能不能开。 */
  enabled: boolean;
  /** 按钮上的短文案。 */
  label: string;
  /**
   * 置灰时**必须显示在按钮旁边**的理由；`enabled` 时为 `null`。
   *
   * 它不许只进 `title`：`disabled` 元素不可聚焦，等于没有理由。
   */
  reason: string | null;
  /**
   * 打开的是**什么** —— 决定宿主走哪条路：
   *
   * | kind | 含义 | 宿主动作 |
   * | --- | --- | --- |
   * | `live` | 成员进程还在，接管它的 PTY | `openExistingTerminalTab` |
   * | `archive` | 成员已退出（`terminalId` 已清），按原生会话 id 看**历史** | 打开 `conversation` tab |
   *
   * 这两个不是同一件事：PTY 接管看的是「进程还在不在」，历史读的是「磁盘上有没有记录」。
   * 把后者也塞进终端路径，症状正是用户报的「会话 id 找不到」（PTY 已随进程消失）。
   */
  kind: 'live' | 'archive';
}

const OPEN: OpenTerminalAction = { enabled: true, label: '打开会话', reason: null, kind: 'live' };
const OPEN_ARCHIVE: OpenTerminalAction = {
  enabled: true,
  // 文案区分：已退出的成员打开的是记录，不是活进程。
  label: '查看记录',
  reason: null,
  kind: 'archive',
};
const NO_SESSION: OpenTerminalAction = {
  enabled: false,
  label: '打开会话',
  reason: '暂无会话',
  kind: 'live',
};

/**
 * 判据（两条，按优先级）：
 *
 * 1. `terminalId != null` ⇒ **活的 PTY**（接管）。
 * 2. 否则 `agentSessionId != null` ⇒ **历史记录**（已退出，但会话文件还在）。
 * 3. 两者都没有 ⇒ 置灰，理由「暂无会话」。
 *
 * # 为什么第 2 条不能省（用户报障）
 *
 * `archive_member` 在归档时清掉 `terminalId`（避免给死进程一个死按钮）—— 但那让
 * **已退出的成员**从面板上彻底消失，而它的会话记录仍在磁盘上。`agentSessionId` 是
 * 观察者从 hook 事件记下来的，正好是 `conversation` 域要的 `agentId:nativeId` 的一半。
 */
export function openTerminalAction(
  member: Pick<MemberStatusView, 'terminalId' | 'agentSessionId'>,
): OpenTerminalAction {
  if (member.terminalId !== null) return OPEN;
  if (member.agentSessionId !== null && member.agentSessionId.trim() !== '') {
    return OPEN_ARCHIVE;
  }
  return NO_SESSION;
}
