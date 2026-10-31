import type { Tab } from '@/shared/types/tab';

/**
 * 新建终端 tab 的占位标题（`Terminal N`）。
 *
 * **不含 agent 名**：agent 身份由 tab 前导图标表达（`renderEditorTabLeading` 的品牌图标），
 * 标题留给会话真实标题（注册表里的 prompt / OSC）；没有真标题时只说「第几个终端」。
 * `pi` / `claude-code` 这类 id 或 agent 名当标题对用户没有意义，还会与图标重复一次。
 *
 * 放在 `shared/` 而不是 `app/` 或 `features/terminal/`：两个入口（`app/hooks/useTerminalTabs`
 * 与 `features/terminal/hooks/useTerminalTabs`）都要用它，而 `features` 不得依赖 `app`。
 */
export function nextTerminalTitle(existing: { tabs: readonly Tab[] } | undefined): string {
  const terminalCount = (existing?.tabs ?? []).filter((t) => t.data.kind === 'terminal').length;
  return `Terminal ${terminalCount + 1}`;
}
