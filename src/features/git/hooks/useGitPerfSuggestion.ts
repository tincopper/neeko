import { listen } from '@tauri-apps/api/event';
import { useEffect } from 'react';

import { GIT_PERF_SUGGESTION_EVENT } from '@/shared/events';
import { useNotificationStore } from '@/shared/store/notificationStore';
import type { GitPerfSuggestionEvent } from '@/shared/types/git';
import { safeUnlisten } from '@/shared/utils/safeUnlisten';

/**
 * Git 性能引导（G7）：后端在 watch 启动时对「大仓库 + 未启用 fsmonitor /
 * untracked cache」发一次建议事件，本 hook 转为通知展示。
 *
 * 只提示不代改——启用会改变用户仓库行为，命令由用户复制自行执行。
 * 每项目每会话至多展示一次（后端已保证单次发送，此处再以 Set 兜底去重）。
 */
export function useGitPerfSuggestion(): void {
  useEffect(() => {
    const notified = new Set<string>();
    const unlistenPromise = listen<GitPerfSuggestionEvent>(GIT_PERF_SUGGESTION_EVENT, (event) => {
      const { project_id: projectId, suggestions } = event.payload;
      if (suggestions.length === 0 || notified.has(projectId)) return;
      notified.add(projectId);
      const store = useNotificationStore.getState();
      for (const suggestion of suggestions) {
        store.addNotification({
          type: 'info',
          title: 'Git performance suggestion',
          message: `${suggestion.label}: ${suggestion.command}`,
        });
      }
    });
    return () => {
      unlistenPromise.then((unlisten) => safeUnlisten(unlisten)());
    };
  }, []);
}
