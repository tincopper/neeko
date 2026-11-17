/**
 * 团队相关 tab 的**标题构造点**（唯一）。
 *
 * 为什么住 `shared/`：标题由三方共用 —— 建 tab（`features/agent-team` 的两个 hook）、
 * 改名后重写已打开的 tab（`app/dock/wrappers`）、以及宿主层测试。`features/agent-team` 的
 * 门面只导出组件与 hooks（`src/AGENTS.md` 的导入防火墙），所以「字符串模板」只能落在
 * 共享层；放在任何一侧都会逼出第二份拷贝，而两份漂移的症状是「改了名，tab 上是另一种格式」。
 */

/** 队长终端 tab 的标题（建队打开 / 改名后重写共用）。 */
export function leaderTerminalTabTitle(teamName: string): string {
  return `Lead · ${teamName}`;
}

/** 团队看板 / 分配图 tab 的标题（同上）。 */
export function teamBoardTabTitle(teamName: string): string {
  return `Board · ${teamName}`;
}
