import { useCallback } from 'react';

import type { ConversationMeta } from '../types';

/**
 * 删除点击 → 容器层编排 → **只有确认删成功**才通知持有列表的那一层移除行。
 *
 * 为什么这块单独成 hook：列表状态与删除编排分属两层（面板持有本地窗口，容器持有
 * IPC / 确认 / 使用中判定）。`requestDelete` 是容器给的入口，返回 `true` = 磁盘上已删；
 * 失败时这里**不**调 `onDeleted`（乐观移除 = 静默谎报）。
 */
export function useConversationDelete({
  requestDelete,
  onDeleted,
  onError,
}: {
  requestDelete?: (meta: ConversationMeta) => Promise<boolean>;
  onDeleted: (id: string) => void;
  /** 编排自身抛错时（不是「删除失败」）的兜底 —— 破坏性动作不允许静默没反应。 */
  onError?: (error: unknown) => void;
}): (meta: ConversationMeta) => Promise<void> {
  return useCallback(
    async (meta: ConversationMeta) => {
      if (!requestDelete) return;
      try {
        const deleted = await requestDelete(meta);
        if (!deleted) return;
        onDeleted(meta.id);
      } catch (error) {
        // 走到这里说明编排本身炸了（判定 / 确认 / 关 tab 都可能），不是「删除失败」。
        // 旧实现在此**静默吞掉** ⇒ 屏幕上就是「点了没反应」，且控制台之外无痕迹。
        onError?.(error);
      }
    },
    [requestDelete, onDeleted, onError],
  );
}
