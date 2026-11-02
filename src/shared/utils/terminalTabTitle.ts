import type { Tab } from '@/shared/types/tab';

/**
 * 终端 tab 的配额上限（**唯一数字**）。
 *
 * 三个地方都要用它，因此它属于 `shared/` 而不是 `features/terminal/`：
 * `editorStore.addTab` 是硬门（谁都可能调 addTab）、terminal 端口用它产出 `false`
 * 给调用方、`app/` 的侧栏入口用它决定是否静默拒绝。放在 features 里 store 就取不到
 * （防火墙禁止 store → features），于是历史上出现了字面量副本 —— 改一处不改另一处，
 * 配额行为分叉且没有任何报警。
 */
export const MAX_TERMINAL_TABS = 10;

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
