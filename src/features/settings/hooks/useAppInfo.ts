import { useCallback, useEffect, useState } from 'react';

import { getAppInfo } from '@/features/settings/api/settingsApi';
import type { AppInfo } from '@/shared/types/app';

/** About 页数据加载状态。 */
export type AppInfoState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; info: AppInfo };

/**
 * 拉取应用版本/元数据信息（设置面板 About 页数据源）。
 *
 * 数据交互收拢于此 hook，组件仅消费状态；`active` 标志位防止卸载后 setState。
 */
export function useAppInfo() {
  const [state, setState] = useState<AppInfoState>({ status: 'loading' });

  const load = useCallback(async (active: { current: boolean }) => {
    try {
      const info = await getAppInfo();
      if (active.current) setState({ status: 'ready', info });
    } catch (e) {
      console.error('[useAppInfo] Failed to load app info:', e);
      if (active.current) setState({ status: 'error' });
    }
  }, []);

  useEffect(() => {
    const active = { current: true };
    // load 内 setState 均在 await 之后，非同步调用；规则为保守误报，与 useMcpMarketplace 同款豁免
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load(active);
    return () => {
      active.current = false;
    };
  }, [load]);

  const retry = useCallback(() => {
    setState({ status: 'loading' });
    void load({ current: true });
  }, [load]);

  return { state, retry };
}
