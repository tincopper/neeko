/**
 * live-sessions 快照的**派生层**（纯函数，无 React / store 依赖）。
 *
 * 分层约定（`.trellis/spec/frontend/state-management.md`）：store 只存不派生，
 * 派生一律进 selector。两个投影（tab 标题 / 侧栏会话列表）都从这里取，
 * 于是「同一份快照」这件事在代码里也只有一份实现。
 */

import type { SessionKind, SessionRef, SessionView } from '@/shared/types/liveSessions';
import type { Tab } from '@/shared/types/tab';

/** 稳定的空数组：无会话的单元每帧重新 `[]` 会让 memo 失效。 */
export const NO_SESSIONS: readonly SessionView[] = [];

/** 会话身份的最小形状：只要有 `kind` + `sessionId` 就能判定「是不是同一条」。 */
export type SessionIdentity = Pick<SessionView, 'kind' | 'sessionId'>;

/**
 * 两条会话是不是同一条：`kind` 与 `sessionId` **必须同时**相等。
 *
 * 两个字段各自配对 kind（不许混用）：会话 id 由后端铸造，chat 与 terminal 的 id 空间
 * 互不相干，但「一个 id 字符串同时命中两条记录」这种事故一旦发生就只表现为
 * 「点错 tab / 标题串线 / 高亮错行」，很难定位。这是「同一会话」的**唯一**判据，
 * 禁止调用侧自比裸 id。
 */
export function isSameSession(
  a: SessionIdentity | null | undefined,
  b: SessionIdentity | null | undefined,
): boolean {
  if (!a || !b) return false;
  return a.kind === b.kind && a.sessionId === b.sessionId;
}

/**
 * 会话的**进程是否还活着**（不是「已终止」）。
 *
 * 唯一用途：点击侧栏会话行时该**接回**那条活着的 PTY，还是按会话重建。
 * 注意它与 [`isBusySession`] **不是**同一个问题 —— 空闲（`ready`）的会话进程仍然活着，
 * 接回它是对的，但关 tab 时不该弹框（见那个函数的说明）。
 */
export function isLiveSession(session: SessionView): boolean {
  return session.state !== 'stopped' && session.state !== 'failed';
}

/**
 * 会话是否**正在干活**（跑着，或在等审批）。
 *
 * 唯一用途：关 tab 时要不要弹「后台运行 / 退出进程 / 取消」。
 *
 * 为什么不能复用 [`isLiveSession`]：`ready` 的会话进程还活着，但 agent 已经**干完了**
 * —— 这时关 tab 就是普通的关 tab，弹一个「它还在跑」的框是在说假话（2026-11-02 反馈）。
 * 「进程活着」与「有活要丢」是两个问题，判据也因此是两个。
 */
export function isBusySession(session: SessionView): boolean {
  return session.state === 'running' || session.state === 'awaitingApproval';
}

/**
 * 这条会话属于**团队成员**（而不是用户自己）。
 *
 * 唯一用途：把成员会话从侧栏的「我的会话」里摘出去（子列表 / 「接回上一次」），并把
 * 「当前在哪」的提示交给**团队行**。
 *
 * 与 [`isListedSession`] **不是同一个问题**，别合并：后者回答「有没有真标题、用户用没用过」
 * （tab 标题也靠它），归属是**起进程时写入的事实**（`SessionAttribution`），与标题无关
 * —— 一个已经有标题、用户也发过指令的成员会话仍然是成员会话。
 */
export function isTeamMemberSession(session: Pick<SessionView, 'attribution'>): boolean {
  return session.attribution.kind === 'teamMember';
}

/**
 * 会话是否**已经有名字**（＝存在真标题，而不是身份占位）。
 *
 * 判据看的是 `titleSource`，不是「非空」：wire 上的 `title` 永远非空（无真标题时后端给
 * 身份标签，如 `claude-code · neeko`），因此「空串」不再是「没名字」的信号 ——
 * 用非空判会让占位标签冒充真标题（那样任何刚打开的会话都会被当成已有名字）。
 */
export function isNamedSession(session: SessionView): boolean {
  return session.titleSource !== 'placeholder';
}

/**
 * 是否该把这条会话列进侧栏：**用户真的用过，且已经拿到名字**。
 *
 * 两条前提，缺一不可：
 * 1. `hasUserInput` —— 打开 agent tab 就会创建 PTY / 静默会话，那时用户还没敲一个字；
 * 2. `isNamedSession` —— **占位标签不算名字**。占位（`claude-code · neeko`）只用来让
 *    tab / 历史列表永远有字可读，不是「这条会话可以进列表」的信号；否则一条没有信息量的行
 *    会常驻侧栏（第 35 轮踩过）。
 *
 * **不看回合数**（2026-11-10 定案：「拿到标题就出现」）。理由：
 * - 用户要的是「输入指令 → 标题到手 → 行出现」，而不是「等这一轮跑完」；
 * - 依赖回合数还有一个隐性坏账：`session_store` 不持久化 `turn_count`，重启后回填的行
 *   恒为 0 —— 那会逼出一个 `native|user` 直通特例（旧实现就有），而特例本身又让判据
 *   分叉。去掉这条依赖，特例一起消失。
 *
 * 换句话说：**打开 CLI 不出行；用户提交指令、标题到手的那一帧出现**。
 */
export function isListedSession(session: SessionView): boolean {
  return session.hasUserInput && isNamedSession(session);
}

/**
 * 前台会话已被某个**单元内的子行**代表的单元集合（父行据此让出选中态）。
 *
 * 父行不能只看 tab 身份：未输入 / 还没名字的会话不会出现在子列表，
 * 此时让出填充色会让「当前」在整个侧栏消失。
 *
 * # 只有**列在单元下的**会话算（团队容器行不再算）
 *
 * 成员会话的代表者是**项目层的团队容器行**（`ProjectTeamList`），它不再是任何单元的子项
 * （2026-11 容器模型）。所以成员会话不该让单元行让出选中态 —— 否则单元行不填、而行内
 * 也没有任何子行是亮的，表现就是「当前」在侧栏层级上凭空消失一级。
 *
 * 成员会话在前台时「当前」仍可被看见：由 [`foregroundTeamId`] 在团队容器行上表达
 * （`row-current`）。两者读同一份快照，只是一个回答「哪一行是当前」，一个回答
 * 「父行要不要让出」。
 *
 * 与 [`foregroundTeamId`] 用**同一条**「命中的第一条 ref 说了算」规则。
 */
export function unitsWithListedActiveSession(
  refs: readonly SessionRef[],
  sessions: readonly SessionView[],
): Set<string> {
  const units = new Set<string>();
  for (const ref of refs) {
    const found = sessions.find(
      (session) => session.workspaceKey === ref.workspaceKey && isSameSession(session, ref),
    );
    if (found === undefined) continue;
    // 成员会话的代表者是项目层的团队行（不是本单元的子行）—— 不让父单元让出选中底。
    if (isTeamMemberSession(found)) continue;
    if (isListedSession(found)) units.add(found.workspaceKey);
  }
  return units;
}

/**
 * 按单元分组（`workspaceKey → 会话列表`），**只含该列出的用户会话**
 * （`isListedSession` 且不是团队成员会话）。
 *
 * 成员会话**不进**子列表：它们归团队容器行管（展开团队成员就看得见），而单元子列表代表
 * 的是「**我**在这棵树里开过的会话」。两处同时出现才是回归 —— 同一条会话在侧栏有两个家。
 * 过滤保持禁止去掉：它也是 `useUnitsWithActiveSession` 与 `foregroundTeamId` 两侧口径
 * 不漂移的前提。
 *
 * 单元归属只做 `workspaceKey` **相等比较**：key 是后端铸造的唯一地址表示，
 * 在这里拼分隔符或比路径前缀就是第二套身份判据（红线 12）。一次 O(n) 分组供所有
 * 行共用（`useSessionsByUnit`），不按行重扫全表。
 *
 * 返回 `Map` 而不是普通对象：key 含 NUL 分隔符（`WorkspaceSession.key`），
 * 用对象属性会在 `__proto__` 之类的键上产生语义歧义，且丢失插入顺序保证。
 */
export function sessionsByUnit(sessions: readonly SessionView[]): Map<string, SessionView[]> {
  const byUnit = new Map<string, SessionView[]>();
  for (const session of sessions) {
    if (!isListedSession(session)) continue;
    // 成员会话归**团队容器行**（项目层，展开才列出）：在单元子列表里再出现一次，
    // 用户的会话列表就会多出一条不归他管的行。
    if (isTeamMemberSession(session)) continue;
    const list = byUnit.get(session.workspaceKey);
    if (list) list.push(session);
    else byUnit.set(session.workspaceKey, [session]);
  }
  return byUnit;
}

/**
 * 按**团队**分组的成员会话（`teamId → memberId → 会话`）。
 *
 * 唯一用途：侧栏**团队容器行**展开后的成员子行（R2）。
 *
 * # 与单元无关的那一次求交（容器模型的全部依据）
 *
 * 归属只读 `SessionView.attribution`：`attribution.kind === 'teamMember'` 时它已带着
 * `teamId` + `memberId`（后端在起进程时写入的事实）。本函数**不看** `workspaceKey` ——
 * 成员跑在哪棵树与「他属于哪个队」是两个独立问题，正因如此团队行才能是跨单元的容器：
 * 一旦这里开始看单元，成员空间（每人一棵树）到来时这张表就会漏人。
 *
 * # 一个成员只留一条
 *
 * 一个成员同一时刻只有一条活 PTY，但**终止后的旧会话仍可能留在快照里**。两条优先级
 * 不能反过来：
 *
 * 1. 活着的那条优先（`isLiveSession`：侧栏点它就是「接管这条 PTY」）；
 * 2. 同龄则取 `startedAt` **最大**的那条（不是数组末位 —— 快照顺序是后端的事）。
 *
 * 反过来的症状是「点成员行打不开那条还活着的会话」。
 *
 * 成员**名**不在这里：那只能来自花名册（`TeamSnapshot.members`）。会话上只有
 * `memberId`（形如 `w1@tm_1`），从它拆名字是第二套身份解析（红线 12 同族），
 * 而且成员改名后就与花名册漂移。
 */
export function memberSessionsByTeam(
  sessions: readonly SessionView[],
): Map<string, Map<string, SessionView>> {
  const byTeam = new Map<string, Map<string, SessionView>>();
  for (const session of sessions) {
    const attribution = session.attribution;
    if (attribution.kind !== 'teamMember') continue;
    let byMember = byTeam.get(attribution.teamId);
    if (byMember === undefined) {
      byMember = new Map<string, SessionView>();
      byTeam.set(attribution.teamId, byMember);
    }
    const rival = byMember.get(attribution.memberId);
    if (rival === undefined || prefersSession(session, rival)) {
      byMember.set(attribution.memberId, session);
    }
  }
  return byTeam;
}

/** [`memberSessionsByTeam`] 的排序规则：活的优先，同龄取更晚开始的（见该函数的文档）。 */
function prefersSession(candidate: SessionView, rival: SessionView): boolean {
  const candidateLive = isLiveSession(candidate);
  const rivalLive = isLiveSession(rival);
  if (candidateLive !== rivalLive) return candidateLive;
  // ISO8601 字符串可直接字典序比较（后端统一 UTC `to_rfc3339` 形态）。
  return candidate.startedAt > rival.startedAt;
}

/**
 * 该单元里某种类**最近开始**的一条会话（只认用户真的用过的：`isListedSession`）。
 *
 * 唯一用途：点种类入口图标时，「接回 / 续写上一次那一条」而不是新建一条空会话。
 * 没有它的话同一个图标会有两种语义（有 tab 时回到 tab，没 tab 时开空会话），而用户刚
 * 关掉的那条会话在注册表里还活着。
 *
 * 三条判据都不能少：
 * - `workspaceKey` 相等 —— 单元隔离（切项目不得接回别的单元的会话）；
 * - `kind` 相等 —— chat 与 terminal 的 id 空间互不相干（见 `isSameSession`）；
 * - `isListedSession` —— 与侧栏同一个判据：打开 tab 就会建静默会话，还要等标题到手，
 *   把那些当成「上次那一条」会让第一次点图标就接回一个空会话。
 *
 * 取 `startedAt` **最大值**而不是数组末位：快照顺序是**后端**的事（store 明确写了
 * 「前端不重排」），依赖顺序等于把「哪条更新」寄托在两份实现恰好同向。
 *
 * 成员会话**不参与**：点是用户的动作 —— 接回一个成员的 PTY 等于让用户接管了他管不着的
 * 会话（它的生命周期只由团队域结束）。
 */
export function selectLatestSessionForUnit(
  sessions: readonly SessionView[],
  workspaceKey: string,
  kind: SessionKind,
): SessionView | null {
  let latest: SessionView | null = null;
  for (const session of sessions) {
    if (session.workspaceKey !== workspaceKey) continue;
    if (session.kind !== kind) continue;
    if (!isListedSession(session)) continue;
    if (isTeamMemberSession(session)) continue;
    // ISO8601 字符串可直接字典序比较（后端统一 UTC `to_rfc3339` 形态）
    if (latest === null || session.startedAt > latest.startedAt) latest = session;
  }
  return latest;
}

/**
 * 前台正在看的那条会话如果是**团队成员**的，返回它所属的团队 id；否则 `null`。
 *
 * 唯一用途：侧栏**团队行**的「当前」态。
 *
 * 为什么读快照而不是自己记账：前台是哪条会话是 tab 布局的事实（`refs` = 前台 refs，
 * 顺序即前台优先），它属于谁由快照的 `attribution` 说 —— 本地再记一份「我打开了谁的会话」
 * 就是第二份真相（红线 17），而且两份一旦漂移，症状只是「高亮错行」，没人会报。
 *
 * 外层循环是 `refs`（不是 `sessions`）：前台优先级在 `refs` 的顺序里，**先命中那条会话的说了算**
 * —— 与 `UnitSessionList.activeSession`（子行高亮）/ `SessionListRow` 同一条规则：中心前台存在时
 * 它就是「当前」，此时停靠槽里的成员会话**不是**（否则用户自己的中心会话行与团队行会同时亮）。
 * 只有该 ref 在快照里**没有**对应会话（未注册 / 已消失）时才看下一个 ref。
 * 单元隔离靠 `workspaceKey` 相等 + `isSameSession`（同 id 的另一单元 / 另一 kind 不算命中）。
 *
 * **不**在这里判「队长」：谁是队长是 `TeamSummary.leadMemberId` 的事实，会话层不存队长身份。
 */
export function foregroundTeamId(
  refs: readonly SessionRef[],
  sessions: readonly SessionView[],
): string | null {
  for (const ref of refs) {
    const found = sessions.find(
      (session) => session.workspaceKey === ref.workspaceKey && isSameSession(session, ref),
    );
    if (found === undefined) continue;
    // 类型窄化：`isTeamMemberSession` 是布尔判据，拿不到 discriminated union 的窄化。
    // 命中的**第一**条会话就是「当前」，它是不是成员会话在此一次判定（不得越过它继续找）。
    return found.attribution.kind === 'teamMember' ? found.attribution.teamId : null;
  }
  return null;
}

/**
 * tab 的会话身份：chat 用 `data.sessionId`，terminal 用 `data.ptySessionId`，其余 kind 没有。
 */
function tabSessionKey(tab: Tab): { kind: SessionKind; sessionId: string } | null {
  if (tab.data.kind === 'agent-chat') {
    return tab.data.sessionId ? { kind: 'chat', sessionId: tab.data.sessionId } : null;
  }
  if (tab.data.kind === 'terminal') {
    return tab.data.ptySessionId ? { kind: 'terminal', sessionId: tab.data.ptySessionId } : null;
  }
  return null;
}

/** tab → 它对应的 live session（未注册 / 尚未创建 PTY 时为 `null`）。 */
export function tabSession(
  tab: Tab | null | undefined,
  sessions: readonly SessionView[],
): SessionView | null {
  if (!tab) return null;
  const key = tabSessionKey(tab);
  if (!key) return null;
  return sessions.find((session) => isSameSession(session, key)) ?? null;
}

/** [`tabSession`] 的逆：会话 → 承载它的 tab（侧栏点会话行时激活它）。 */
export function sessionTab(session: SessionView, tabs: readonly Tab[]): Tab | null {
  return (
    tabs.find((tab) => {
      const key = tabSessionKey(tab);
      return key !== null && isSameSession(session, key);
    }) ?? null
  );
}
