/**
 * 插入端口注册表 —— 「把一段文本投进某个能接收文本的面」的**唯一身份入口**。
 *
 * # 为什么是「渲染方注册」而不是「扫缓存猜」
 *
 * 2026-11 实测缺陷：从文件树拖文件到输入位置，**终端降级分支永远 miss**。原因是
 * `terminalRouting.insertToTerminalTarget` → `terminalCache.resolveTerminalEntry` 的
 * `paneId` 默认值 `'p1'`，而终端缓存键是三元组 `terminalAddress(session, tabId, paneId)`
 * （`paneId` 由渲染它的 `PaneContent` / dock 槽位传入）⇒ 终端只要不在第一个 pane
 * （右侧 dock、分屏），精确键必然 miss，且 `{ ok: false }` 静默无提示。
 *
 * 根因不是「paneId 默认值写错了」，而是**投递方在猜一件只有渲染方才知道的事**。
 * 因此本模块把方向反过来：**谁能接文本，谁自己带着身份来登记** —— PTY sessionId /
 * paneId / 是否激活 / DOM 根，这四样只有渲染方同时持有。于是「猜 paneId」这一步
 * 在结构上不存在。
 *
 * # 与红线的对齐
 *
 * - 红线 12（不从字符串反解身份）：`sessionKey` / `id` 都由注册方**已经持有的**
 *   身份直接下传，本模块不解析、不归一、不 `endsWith`。
 * - R6（禁止标签名启发式）：本模块只回答「哪个端口被指针 / 焦点命中」，
 *   焦点是**已注册端口的键**，不是「这个元素是什么输入」的代理判据。
 *   「这一下能不能落地」由端口的 `insert()` 返回值回答，调用方拿 false 就继续降级。
 *
 * # 形态照抄仓内三处同构先例
 *
 * `agent-chat/api/agentInputRegistry.ts`（身份键 + 未命中 false）、
 * 编辑器域已有的 `EditorView` 注册表（引用计数卸载）、`composer/editorRegistry.ts`（实例登记）。
 */

/** 端口种类 —— 仲裁顺序的 ④⑤⑥ 三段各取一类（见 `useFileDrop`）。 */
export type InsertPortKind = 'agent-composer' | 'code-editor' | 'terminal';

export interface InsertPort {
  /** 端口身份（由注册方铸造：terminal key / editor identity / `${tabKey}:${tabId}`）。 */
  id: string;
  kind: InsertPortKind;
  /** 端口所属 session（仲裁只在该 session 内挑端口）。 */
  sessionKey: string;
  /** 端口根元素：pointer / focus 命中的判据（`contains`）；无 DOM 的端口为 null。 */
  el: HTMLElement | null;
  /** 该端口当前是否处于「激活」形态（布局前台 tab / 分屏 active pane）。 */
  isActive: () => boolean;
  /** 真正的插入；`false` = 本次没落地（调用方继续下一个端口）。 */
  insert: (text: string) => boolean;
}

interface Registration {
  port: InsertPort;
  /**
   * 引用计数：同身份多挂载（React StrictMode 双挂载）时 count > 1，卸载只减不删 ——
   * 先卸载的那次不得摘掉仍存活的登记。值与 `agentInputRegistry` 同构。
   */
  count: number;
}

const registrations = new Map<string, Registration>();

/**
 * 登记（或替换）一个插入端口；同身份重复登记累加引用计数。
 *
 * 同 id 重复登记时**以后者为准**：先来的闭包可能捕获了已卸载的实例（重建的
 * CodeMirror view / 新建的 PTY）。计数仍然是两倍，卸载次数对得上。
 */
export function registerInsertPort(port: InsertPort): void {
  const cur = registrations.get(port.id);
  registrations.set(port.id, { port, count: cur ? cur.count + 1 : 1 });
}

/** 注销：计数减到 0 才真正摘除；对不存在的 id 是幂等无操作。 */
export function unregisterInsertPort(id: string): void {
  const cur = registrations.get(id);
  if (!cur) return;
  if (cur.count <= 1) registrations.delete(id);
  else registrations.set(id, { port: cur.port, count: cur.count - 1 });
}

/** 某 session 内的全部端口（登记顺序 = 渲染顺序，仲裁按此序试）。 */
export function listInsertPorts(sessionKey: string): InsertPort[] {
  const out: InsertPort[] = [];
  for (const { port } of registrations.values()) {
    if (port.sessionKey === sessionKey) out.push(port);
  }
  return out;
}

/** 某 session 内某一类的端口（④⑤⑥ 各取一类）。 */
export function portsOf(sessionKey: string, kind: InsertPortKind): InsertPort[] {
  return listInsertPorts(sessionKey).filter((port) => port.kind === kind);
}

/**
 * 最内层命中者 —— 嵌套端口（编辑器里的输入框、终端里的搜索框）不打架。
 *
 * 判据是结构性的（`contains` 关系），不涉及任何标签名 / class 名的形状推断：
 * 命中集里「自己不被别的命中端口包含」的那个就是最内层。
 */
function innermost(candidates: InsertPort[], hit: Node | null): InsertPort | null {
  if (!hit) return null;
  const matching = candidates.filter((port) => port.el !== null && port.el.contains(hit));
  if (matching.length === 0) return null;
  const deepest = matching.filter(
    (port) =>
      !matching.some((other) => other !== port && port.el !== null && port.el.contains(other.el)),
  );
  return deepest[0] ?? matching[0];
}

/**
 * ① 指针落点所在端口（拖拽期间记下的坐标 + `elementFromPoint`）。
 *
 * 为什么用坐标而不是 `drop` 事件：本仓的拖拽投递刻意走 `dragend`（保证触发、无需
 * `preventDefault`、也不吞掉浏览器的默认拖放），坐标因此是唯一低耦合的落点信号。
 */
export function resolvePortAtPoint(sessionKey: string, x: number, y: number): InsertPort | null {
  const hit = document.elementFromPoint?.(x, y) ?? null;
  return innermost(listInsertPorts(sessionKey), hit);
}

/**
 * ② 焦点所在端口。
 *
 * **焦点只作为已注册端口的键**：本函数不判断「焦点元素是什么」，只回答「它落在哪个
 * 端口里」。没有端口包含它 → null，继续走下一级仲裁。
 * `document.body` 视为无焦点（它是所有端口的祖先，不构成「焦点在端口内」）。
 */
export function resolvePortAtFocus(sessionKey: string): InsertPort | null {
  const active = document.activeElement;
  if (!active || active === document.body) return null;
  return innermost(listInsertPorts(sessionKey), active);
}
