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
 * 会话是否已经有名字（＝注册表里存在真标题）。
 *
 * 判据只有「非空」一条：后端 `title::admit` 对 `Placeholder` **恒**返回 `None`，
 * 于是 `titleSource === 'placeholder' ⟺ title === ''` 恒成立（`registry::has_real_title`
 * 因此退化成同一个判据）。把来源再写一遍就是同一事实的第二份表达 —— 而两份判据
 * 迟早会漂移。
 *
 * 标题可能来自首条 prompt / 首条终端输入（`Prompt`）、CLI 自报的会话主题（`Native`）、
 * 用户改名（`User`）；`Placeholder` 只是「还没起名」的占位，恒为空串。
 */
export function isNamedSession(session: SessionView): boolean {
  return session.title.trim().length > 0;
}

/**
 * 是否该把这条会话列进侧栏：**用户已经在里面输入过**。
 *
 * 只有一个条件：`hasUserInput`。它挡住的是一类「假的会话」—— 打开 agent tab 就会创建
 * PTY / 静默会话，那时用户还没敲一个字（Codex 那样的桌面端也是「发出第一条消息后才建会话」）。
 *
 * **为什么不再要求「有名字」**（第 35 轮修正，实测回归）：可见性与命名是两件不同的事。
 * 第 35 轮把「首条终端输入 = 标题」从生产者集合里删掉后，没有 CLI hook 的终端会话
 * （纯 shell、未装 hook 的 agent）**永远等不到名字** —— 继续把「有名字」当列出条件，
 * 它们会整条从侧栏消失。旧实现之所以能成立，靠的是「首条输入即命名」那个已被删除的通道。
 *
 * 无名字的行由视图解释成「图标 + 时间 + 状态」的占位行（`SessionList` 已有这个分支），
 * 不需要后端编一个假名字（`Placeholder` 恒为空串，`title::admit` 永不放行）。
 */
export function isListedSession(session: SessionView): boolean {
  return session.hasUserInput;
}

/**
 * 前台会话已实际列出的单元集合（父行据此让出选中态）。
 *
 * 父行不能只看 tab 身份：未输入的会话不会出现在子列表，
 * 此时让出填充色会让「当前」在整个侧栏消失。判据与 `sessionsByUnit` 同源。
 */
export function unitsWithListedActiveSession(
  refs: readonly SessionRef[],
  sessions: readonly SessionView[],
): Set<string> {
  const units = new Set<string>();
  for (const ref of refs) {
    if (
      sessions.some(
        (session) =>
          session.workspaceKey === ref.workspaceKey &&
          isSameSession(session, ref) &&
          isListedSession(session),
      )
    ) {
      units.add(ref.workspaceKey);
    }
  }
  return units;
}

/**
 * 按单元分组（`workspaceKey → 会话列表`），**只含该列出的会话**（`isListedSession`）。
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
    const list = byUnit.get(session.workspaceKey);
    if (list) list.push(session);
    else byUnit.set(session.workspaceKey, [session]);
  }
  return byUnit;
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
 * - `isListedSession` —— 与侧栏同一个「用户在用它」的判据：打开 tab 就会建静默会话，
 *   把那些当成「上次那一条」会让第一次点图标就接回一个空会话。
 *
 * 取 `startedAt` **最大值**而不是数组末位：快照顺序是**后端**的事（store 明确写了
 * 「前端不重排」），依赖顺序等于把「哪条更新」寄托在两份实现恰好同向。
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
    // ISO8601 字符串可直接字典序比较（后端统一 UTC `to_rfc3339` 形态）
    if (latest === null || session.startedAt > latest.startedAt) latest = session;
  }
  return latest;
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
