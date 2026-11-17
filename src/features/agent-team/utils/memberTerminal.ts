import type { MemberStatusView } from '@/shared/types/team';

/**
 * 「打开会话」这个动作的**唯一**判据。
 *
 * # 为什么它是纯函数而不是按钮里的 `disabled={!member.session.live}`
 *
 * 置灰本身**不构成理由**：用户看到一个不可点的按钮，唯一能得到的解释是悬停提示，
 * 而 `disabled` 元素不可聚焦 —— 键盘用户、读屏用户、以及「手指点上去什么都没发生」的人都
 * 拿不到那行 `title`。所以「能不能开」与「为什么不能开」必须一起产出，理由还要由调用方
 * 渲染成**可见文字**（见 `RosterRow`）。
 *
 * # 输入是三个**正交**的事实
 *
 * | 事实 | 谁回答 | 是运行态还是意图 |
 * | --- | --- | --- |
 * | `session` | `live_sessions` 注册表（每次读现场查）| 运行态：现在有没有进程 |
 * | `resumable` | 后端（`agent_session_id` + 该 CLI 的续接形态）| 能力：进程没了还接不接得回来 |
 * | `sealed` | 成员行（落库）| 用户意图：关掉过没有 |
 *
 * 合成一个判据就会出现两种误判，而它们的恢复动作**相反**：把「收尾窗口」读成「已退出」
 * （用户点了关闭，进程还没退干净），或把「进程崩了」读成「用户关掉了」。
 *
 * # 五态
 *
 * | `session.live` | `resumable` | `agentSessionId` | `sealed` | 动作 |
 * | --- | --- | --- | --- | --- |
 * | ✅ | — | — | — | `打开会话`（接管那个 PTY）|
 * | ❌ | ✅ | 有 | ❌ | `恢复会话`（起一个新进程续接**同一个**会话）|
 * | ❌ | — | 有 | — | `查看记录`（`conversation` tab，只读）|
 * | ❌ | — | 无 | ❌ | 置灰：`暂无会话` |
 * | ❌ | — | 无 | ✅ | 置灰：`已关闭` |
 *
 * 三条不能丢的排序理由：
 *
 * 1. **`session.live` 必须最先判**：一个被封存的成员在收尾窗口里仍可能是活的，而那时
 *    **能用**的动作是接管它（用户点了关闭，但还没关完，看一眼输出是合理需求）。
 * 2. **`resumable` 优先于 `archive`**：有续接形态时，**主**动作是把对话接回来；记录是
 *    接不回来时才看的东西。把两者反过来，用户会以为「团队恢复后只能读历史」。
 * 3. **封存优先于 `resumable`**：`sealed` 是用户的决定，恢复到进程等于撤销它（后端同样
 *    拒绝），所以封存 + 有原生 id 一律 `查看记录` —— 命中前三条之外的那一行。
 *
 * 第四态与第五态都不可点，但理由必须不同：看到「暂无会话」的用户会去重试，看到「已关闭」的不会。
 *
 * 还有一条不是错的「例外」：CLI 没有续接形态的成员（qoder / gemini 有原生 id）仍然得到
 * `查看记录`，**不是**置灰按钮 —— 那是真实的能力差异（它确实说过话），不是一个错误，也不该
 * 挡住用户看它说了什么。缺这个形态时**绝不**退化成「新开一个裸 CLI」：那正是这次要修的缺陷
 * （用户得到一个空对话，以为对话续上了）。
 *
 * # 为什么不用成员行的 `state` 判活
 *
 * `state` 是**事件驱动**的投影（hook 上报什么就是什么），它会滞后于进程；而 `session`
 * 是注册表现场查的结果。用 `state` 判活会让「刚崩、还没上报」的成员显示成可点。
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
   * | `resume` | 身份在、进程不在：起一个**新进程**续接同一个原生会话 | `team_resume`（成员级）|
   * | `archive` | 成员已退出，按原生会话 id 看**历史** | 打开 `conversation` tab |
   *
   * 三者不是同一件事：PTY 接管看的是「进程还在不在」，恢复接管的是一个**新进程**，
   * 历史读的是「磁盘上有没有记录」。把恢复塞进终端路径，症状正是用户报的「会话 id 找不到」
   * （PTY 已随进程消失）；把它塞进历史路径，症状是「点了查看记录，对话没有回来」。
   */
  kind: 'live' | 'resume' | 'archive';
}

const OPEN: OpenTerminalAction = {
  enabled: true,
  label: 'Open session',
  reason: null,
  kind: 'live',
};
const OPEN_RESUME: OpenTerminalAction = {
  enabled: true,
  // 与「查看记录」的差别是**接管一个新进程**，不是读历史 —— 文案必须能区分这两件事。
  label: 'Resume session',
  reason: null,
  kind: 'resume',
};
const OPEN_ARCHIVE: OpenTerminalAction = {
  enabled: true,
  // 文案区分：已退出的成员打开的是记录，不是活进程。
  label: 'View history',
  reason: null,
  kind: 'archive',
};
const NO_SESSION: OpenTerminalAction = {
  enabled: false,
  label: 'Open session',
  reason: 'No session yet',
  kind: 'live',
};
const SEALED: OpenTerminalAction = {
  enabled: false,
  label: 'Open session',
  reason: 'Closed',
  kind: 'live',
};

type TerminalJudgementInput = Pick<
  MemberStatusView,
  'session' | 'agentSessionId' | 'sealed' | 'resumable'
>;

/** 有没有一条能读的原生会话记录（空白 id 当作没有：它拼不出 `agentId:nativeId`）。 */
function hasNativeSession(member: TerminalJudgementInput): boolean {
  return member.agentSessionId !== null && member.agentSessionId.trim() !== '';
}

/**
 * 判据（见模块文档的五态表）。
 *
 * 顺序不是风格：`session.live` 必须最先判 —— 一个被封存的成员在收尾窗口里仍可能是活的，
 * 而那时**能用**的动作是接管它（用户点了关闭，但还没关完，看一眼输出是合理需求）。
 */
export function openTerminalAction(member: TerminalJudgementInput): OpenTerminalAction {
  if (member.session.live) return OPEN;
  if (hasNativeSession(member)) {
    // 有记录 ⇒ 至少还能看。能不能**接回来**是另一件事：`resumable` 说是能力，
    // `sealed` 说是用户意图（恢复等于撤销它），两者都过才给「恢复会话」。
    if (member.resumable && !member.sealed) return OPEN_RESUME;
    return OPEN_ARCHIVE;
  }
  return member.sealed ? SEALED : NO_SESSION;
}

/**
 * 这个队里有没有**可恢复**的成员（`TeamHeader` 的「恢复团队」显隐判据）。
 *
 * 它走的是 [`openTerminalAction`] 本身，不另写一份 `!live && resumable`：第二份判据必然
 * 漂移，而漂移的症状是「头部的全队恢复按钮亮着，但每个成员行都写着查看记录」（或者反过来，
 * 一个可恢复的成员因为封存被算进来了）。同一个判据只允许有一个产出点。
 */
export function hasResumableMember(
  members: readonly Pick<MemberStatusView, 'session' | 'agentSessionId' | 'sealed' | 'resumable'>[],
): boolean {
  return members.some((member) => openTerminalAction(member).kind === 'resume');
}

/** 恢复成功后要接管的东西（`openExistingTerminalTab` 的三个参数，projectId 由宿主补）。 */
export interface ResumedTerminalTarget {
  /** **新铸的** PTY 句柄（旧的那个已随进程消失）。 */
  terminalId: string;
  /** tab 标题：成员名（用户要在 tab 栏认出是谁）。 */
  title: string;
  /** 会话所属 agent（tab 栏品牌图标）；没有就是通用终端图标。 */
  agentId: string | undefined;
}

/**
 * 「恢复会话 = 打开会话」的第二半：恢复之后要接管**哪个** PTY（`null` = 什么都不开）。
 *
 * # 输入是**重取之后**的花名册，不是那份报告
 *
 * `TeamResumeReport.resumed` 只说「这几个成员的进程起来了」。新的 `terminalId` 是后端在
 * 这次恢复里**新铸的**，只存在于重取后的快照里 —— 所以调用方必须先等刷新落地
 * （`useTeamResume` 会 `await onSettled`），再拿新快照问本函数。
 *
 * # 为什么没有句柄就返回 `null`，而不是退一步
 *
 * 两种退步都会骗人：拿旧的（已随进程消失的）`terminalId` 去接管，症状是用户报的
 * 「会话 id 找不到」；退到只读历史，症状是「点了恢复，对话没有回来」。`cold` / `failed`
 * 的成员就是真的没有新进程 —— 那时**零点一个东西**才是诚实的。
 */
export function resumedTerminalTarget(
  members: readonly Pick<MemberStatusView, 'memberId' | 'name' | 'agentId' | 'session'>[],
  memberId: string,
): ResumedTerminalTarget | null {
  const member = members.find((candidate) => candidate.memberId === memberId);
  if (member === undefined) return null;
  // 句柄只在 live 时非空（`session` 是注册表现场查的结果），所以这一个判据就够了 ——
  // 与花名册 / 抽屉取句柄的口径相同。
  const terminalId = member.session.terminalId;
  if (terminalId === null) return null;
  return { terminalId, title: member.name, agentId: member.agentId };
}
