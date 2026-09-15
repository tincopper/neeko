import { useEffect } from 'react';

import { useProjectStore } from '@/shared/store/projectStore';

import { isLiveSession } from '../store/debug/shared';
import { useDebugStore } from '../store/debugStore';

/**
 * 项目切换时释放旧项目会话：终止其后端进程并标记 terminated（静默，不打开面板）。
 *
 * 配套 #14 的显示层屏蔽：显示层负责「不显示别项目的会话」，本 hook 负责「切走即终止
 * 旧会话」——避免旧项目调试进程在后台继续运行、其 DAP 事件持续累积进全局 store。
 * 挂载点须常驻（DebugRunButton 挂载于 title bar）。
 */
export function useDebugSessionLifecycle() {
  const activeProjectId = useProjectStore((s) => s.activeProject?.id ?? null);

  useEffect(() => {
    const st = useDebugStore.getState();
    const session = st.session;
    if (session && session.projectId !== activeProjectId && isLiveSession(session)) {
      void st.stopSilent();
    }
  }, [activeProjectId]);
}
