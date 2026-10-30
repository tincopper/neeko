import { useCallback } from 'react';

import type { ConversationMeta } from '../types';

import { useConversationDelete } from './useConversationDelete';

/**
 * 面板侧的删除动作装配：**成功才清选中 + 移除行**，编排自身抛错必须可见。
 *
 * 为什么单独成 hook（而不是留在 `ConversationPanel`）：
 * - 面板已贴组件规模 ratchet 线，这段是「删除动作的装配」而不是「面板布局」；
 * - 它有三个状态写入点（清 `activeId`、移除行、失败 toast），散在面板里没人看得出
 *   「成功才动列表」这条判据。
 *
 * 判据链（与 `useConversationDelete` 同一契约）：
 * `requestDelete` 返回 `true` = 磁盘上确实删掉了 ⇒ 才清选中、才移除行；
 * 取消 / 失败 / 抛错一律**不动列表**（乐观移除 = 静默谎报）。
 */
export function useConversationDeleteAction(params: {
  requestDelete?: (meta: ConversationMeta) => Promise<boolean>;
  /** 从本地已加载窗口移除一行（持有列表状态的那一层提供）。 */
  removeConversation: (id: string) => void;
  /** 删除成功后的额外清理（面板用来清 `activeId`）。 */
  onDeleted?: (id: string) => void;
  /** 编排自身失败（判定 / 确认 / 关 tab 抛错）时的提示口。 */
  showToast: (message: string, type?: 'info' | 'error') => void;
}): (meta: ConversationMeta) => Promise<void> {
  const { requestDelete, removeConversation, onDeleted, showToast } = params;

  const handleDeleted = useCallback(
    (id: string) => {
      onDeleted?.(id);
      removeConversation(id);
    },
    [onDeleted, removeConversation],
  );

  // 编排自身抛错（判定 / 确认 / 关 tab）必须可见：破坏性动作不允许「点了没反应」。
  const handleStartError = useCallback(
    (error: unknown) => {
      // eslint-disable-next-line no-console -- 失败现场要留在控制台，toast 只是一句摘要
      console.error('[Conversation] delete failed to start:', error);
      showToast(
        error instanceof Error && error.message ? error.message : 'Could not start the delete flow',
        'error',
      );
    },
    [showToast],
  );

  return useConversationDelete({
    requestDelete,
    onDeleted: handleDeleted,
    onError: handleStartError,
  });
}
