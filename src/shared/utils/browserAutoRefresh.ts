/**
 * Browser tab 的自动刷新门控（纯工具，无 I/O）。
 *
 * picker prompt 提交后，agent 会修改项目文件；`git-changed` / `file-changed`
 * 事件到达时刷新浏览器以展示变更。多 tab 场景下以「项目」为粒度武装：
 * 任一 Browser tab 提交 prompt 即武装该项目，项目内所有已创建的 Browser tab
 * 在事件到达时各自刷新（与旧 dock panel 的单 URL 语义对齐并泛化到多 tab）。
 * 武装带 30s 安全窗超时自动解除，避免事件风暴。
 */

const ARM_WINDOW_MS = 30_000;
const armedProjects = new Set<string>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();

/** 武装指定项目的自动刷新（幂等，重置安全窗计时）。 */
export function armProjectAutoRefresh(projectId: string): void {
  armedProjects.add(projectId);
  const existing = timers.get(projectId);
  if (existing) clearTimeout(existing);
  timers.set(
    projectId,
    setTimeout(() => {
      armedProjects.delete(projectId);
      timers.delete(projectId);
    }, ARM_WINDOW_MS),
  );
}

/** 该项目是否处于自动刷新武装窗口内。 */
export function isProjectAutoRefreshArmed(projectId: string): boolean {
  return armedProjects.has(projectId);
}

/** 立即解除武装（项目切换 / 组件卸载时调用）。 */
export function disarmProjectAutoRefresh(projectId: string): void {
  armedProjects.delete(projectId);
  const t = timers.get(projectId);
  if (t) {
    clearTimeout(t);
    timers.delete(projectId);
  }
}
