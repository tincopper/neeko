import type { MemberStatusView } from '@/shared/types/team';

/**
 * 「打开终端」这个动作的**唯一**判据。
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
 * # 文案为什么说「暂无终端」而不是「无进程」
 *
 * `terminalId === null` 只在说「这个成员此刻没有可打开的终端」，而**不等于**「它没有进程」：
 * 将来接 Chat 类成员（`channel = 'mcp'`，本来就没有 PTY）时，它们会走到这同一条分支 ——
 * 那时「无进程」会是一句错话（进程在跑，只是没有终端）。
 *
 * 扩展点：如果 Chat 成员需要不同的动作（比如「打开对话」而不是「打开终端」），判据的输入要
 * 从 `terminalId` 换成 `channel` + `terminalId` 两个字段，文案也要分叉；在那一刻之前保持
 * 中性措辞，不要在这里抢先写一种假设。
 */
export interface OpenTerminalAction {
  /** 能不能开。 */
  enabled: boolean;
  /** 按钮上的短文案（置灰时保持不变，理由走 [`Self::reason`]）。 */
  label: string;
  /**
   * 置灰时**必须显示在按钮旁边**的理由；`enabled` 时为 `null`。
   *
   * 它不许只进 `title`：`disabled` 元素不可聚焦，等于没有理由。
   */
  reason: string | null;
}

const OPEN: OpenTerminalAction = { enabled: true, label: '打开终端', reason: null };
const NO_TERMINAL: OpenTerminalAction = {
  enabled: false,
  label: '打开终端',
  reason: '暂无终端',
};

export function openTerminalAction(
  member: Pick<MemberStatusView, 'terminalId'>,
): OpenTerminalAction {
  return member.terminalId === null ? NO_TERMINAL : OPEN;
}
