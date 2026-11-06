import { useCallback } from 'react';

import type { AppConfig } from '@/features/settings/types';

/** 切换某 agent 在「隐藏」列表里的去留。 */
export type ToggleHiddenAgent = (agentId: string) => void;

/**
 * 「隐藏 agent」开关的写入逻辑。
 *
 * ## 为什么单独一个 hook（而不是留在 `useAppShellData`）
 *
 * 它是 `config.json` 的一个**独立写入面**，且需要「读-改-写」。把它从组合根里拿出来
 * 有两个效果：组合根只负责接线；本文件的契约有自己的落点，改它不必碰 400 行的文件。
 *
 * ## 并发契约（与 `useAppConfigOwner.saveConfig` 的分工）
 *
 * - **串行化 + 读盘合并**由写点 `saveConfig` 负责（它在 `runConfigWrite` 内重新读盘，
 *   把增量盖在磁盘现值上）。故本 hook **不得**再包一层 `runConfigWrite` ——
 *   那会在队列内二次入队，自我等待成死锁。
 * - 本 hook 只交出**updater**（`current => patch`），由写点在临界区内求值。
 *
 * ## 为什么必须用 updater 而不是自己读一次
 *
 * 「切换」是**相对当前值**的语义（在 → 移除，不在 → 加入）。若在 hook 里用渲染期
 * `config` 算新值，快速连点两次会基于同一份旧值算出同一个结果 —— 丢一次点击。
 * 自己读一次也一样：读在区外就是陈旧的。故这个「当前值」只能由临界区内的写点提供。
 */
export function useHiddenAgentToggle(
  saveConfig: (patch: (current: AppConfig) => Partial<AppConfig>) => Promise<void>,
): ToggleHiddenAgent {
  return useCallback(
    (agentId: string) => {
      // **updater 形态**：`current` 由写点在临界区内从磁盘读出，
      // 故快速连点两次不会基于同一份旧值算出同一个结果（丢一次点击）。
      void saveConfig((current) => {
        const list = current.hiddenAgentIds ?? [];
        return {
          hiddenAgentIds: list.includes(agentId)
            ? list.filter((id) => id !== agentId)
            : [...list, agentId],
        };
      }).catch((e) => {
        // 显式兜底：写点会把失败如实抛出，而本 hook 由一次点击触发、无调用方可以
        // `await`。不接住就是 unhandled rejection（用户点了开关、什么也没发生、控制台
        // 还没有线索）。与 `useAppShellData` 其它失败路径的口径一致：记录即可 ——
        // 该开关没有独立 UI 承载错误提示。
        console.error('[App] Failed to toggle hidden agent:', e);
      });
    },
    [saveConfig],
  );
}
