import { useCallback } from 'react';

import type { SessionView } from '@/shared/types/liveSessions';

import { deleteSession, renameSession } from '../utils/sessionRowActions';

/**
 * 侧栏会话行的两项能力（改名 / 删除），与 `SessionList` 的纯展示职责分开。
 *
 * 本文件只是 React 绑定：判据、顺序与失败处理都在 `utils/sessionRowActions`
 * （无 React，可直测）。保持这层薄的理由与 `useActivateSession` 相同 ——
 * 让「删除一条会话」的语义只有一个实现处，hook 不成为第二个。
 */
export function useSessionRowActions(): {
  rename: (session: SessionView, title: string) => void;
  remove: (session: SessionView) => void;
} {
  const rename = useCallback((session: SessionView, title: string) => {
    renameSession(session, title);
  }, []);

  const remove = useCallback((session: SessionView) => {
    void deleteSession(session);
  }, []);

  return { rename, remove };
}
