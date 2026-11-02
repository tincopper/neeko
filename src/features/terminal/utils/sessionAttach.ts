import { detachTerminalSession, resizeTerminal } from '../api/terminalApi';

/**
 * 「接回一条还活着的 PTY 会话」：成功返回会话 id，会话已经不在则返回 `null`。
 *
 * # 为什么用 `detach_terminal_session(id, false)` 当存活探针
 *
 * 后端那个命令做两件事：把 drain 的分离态关掉（恢复背压），并在 drain 不存在时返回
 * `false`。drain 的存活**就是** PTY 的存活（`close_and_notify` / `exit_and_notify` 都会摘掉
 * 它），所以不需要再加一条 `ping` 命令。
 *
 * # 为什么必须先关分离态
 *
 * 分离态（后台运行）的 drain 只保留尾部、从不背压。不关掉它，接回来之后生产者仍会丢字节。
 *
 * 尺寸也要补一次：分离期间窗口可能被缩放过，而 PTY 的 cols/rows 还是拆下去那一刻的。
 */
export async function attachLiveSession(
  sessionId: string,
  cols: number,
  rows: number,
): Promise<string | null> {
  const alive = await detachTerminalSession(sessionId, false).catch(() => false);
  if (!alive) return null;
  await resizeTerminal(sessionId, cols, rows).catch(() => undefined);
  return sessionId;
}
