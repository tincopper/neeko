/**
 * 终端原生标题（xterm OSC 0/2）→ live-sessions 注册表。
 *
 * # 为什么标题来自 OSC
 *
 * CLI 自己会把窗口标题设成「当前在干什么」（`claude` / `opencode` / vim 都在做），
 * 这是**真实存在的**标题素材，而 terminal 会话在注册表里的初始标题只能是不带信息的
 * 占位（agent 名 / `Terminal`）。xterm 已把 OSC 0/2 翻译成 `onTitleChange` 事件，
 * 不需要另写序列解析。
 *
 * # 去重判据：同会话「值不变不发」
 *
 * xterm 的 `setTitle()` **无条件** fire（详见 `node_modules/@xterm/xterm` 的
 * `setTitle(e){…this._onTitleChange.fire(e)}`），而 CLI 的 spinner 帧会反复发同一个
 * 标题。后端 `Registry::set_title` 在标题未变时不 bump 版本，但每次 IPC 仍是一次跨栈
 * 调用，所以前端在做同一判定前先自己拦一道。
 *
 * **不做时间窗节流**：把 1s 内的变化压成最后一次会把「跑完了」这类关键跃迁压掉，
 * 而标题是用户唯一能看出会话在干什么的信号。去重只认「值」不认「时间」。
 *
 * # 订阅归属
 *
 * `Terminal` 实例跨 React mount 存活（终端缓存），监听器不存活 —— 订阅必须按 effect
 * 生命周期重挂 / 释放，否则 tab 切走会留下一串仍在发 IPC 的闭包。
 */

/** 标题事件源（xterm `Terminal.onTitleChange` 的最小子集，便于用假终端测）。 */
export interface TitleEventSource {
  onTitleChange: (listener: (title: string) => void) => { dispose: () => void };
}

export interface TerminalTitleSyncOptions {
  term: TitleEventSource;
  /** 当前 PTY session id（创建完成前为 `null` ⇒ 暂无归属，标题不发送）。 */
  getSessionId: () => string | null;
  /** 真正的发送方（薄命令 `set_live_session_title`）。 */
  publish: (sessionId: string, title: string) => void;
}

export interface TerminalTitleSync {
  dispose: () => void;
}

/**
 * 折叠空白 + 去首尾（与后端 `title::truncate` 的口径一致）。
 *
 * 前端先做这一步，去重比较的才是**后端将要比较的那个值** —— 否则 `"a  b"` 与
 * `"a b"` 会被前端当成两次变化，各发一次 IPC，后端两次都判定「没变」。
 */
function normalizeTitle(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim();
}

/**
 * 订阅一个终端的标题变化并按会话去重发送。
 *
 * 返回句柄的 `dispose()` 幂等（终端缓存销毁与 effect cleanup 都会调一次）。
 */
export function createTerminalTitleSync({
  term,
  getSessionId,
  publish,
}: TerminalTitleSyncOptions): TerminalTitleSync {
  let disposed = false;
  /** 上一次**成功归属到会话**并发送的值（`null` = 还没发过）。 */
  let last: { sessionId: string; title: string } | null = null;

  const subscription = term.onTitleChange((raw) => {
    if (disposed) return;
    const title = normalizeTitle(raw);
    // 空标题是 OSC 复位（`\e]0;\a`），它表达的是「忘了标题」，不是新标题。
    if (!title) return;
    // 会话还没铸造：**不记基线** —— 记了会把 PTY 建好后的第一个标题永久丢掉。
    const sessionId = getSessionId();
    if (!sessionId) return;
    if (last !== null && last.sessionId === sessionId && last.title === title) return;
    last = { sessionId, title };
    publish(sessionId, title);
  });

  return {
    dispose: () => {
      disposed = true;
      subscription.dispose();
      last = null;
    },
  };
}
