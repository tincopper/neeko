import type { Tab } from '@/shared/types/tab';

/**
 * **空白终端**（不绑 agent）的占位标题：`Terminal N`。
 *
 * 绑了 agent 的 tab 用 agent 名当占位（初版行为）；两者都只是「会话起名前的占位」——
 * 会话真标题（首条 prompt / CLI 的 OSC 标题）到手后，`resolveTabTitle` 在渲染期覆盖它，
 * 不写回 tab store。
 *
 * 放在 `shared/` 而不是 `app/` 或 `features/terminal/`：两个入口（`app/hooks/useTerminalTabs`
 * 与 `features/terminal/hooks/useTerminalTabs`）都要用它，而 `features` 不得依赖 `app`。
 */
export function nextTerminalTitle(existing: { tabs: readonly Tab[] } | undefined): string {
  const terminalCount = (existing?.tabs ?? []).filter((t) => t.data.kind === 'terminal').length;
  return `Terminal ${terminalCount + 1}`;
}
