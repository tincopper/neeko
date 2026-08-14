import type { ReactNode } from 'react';

import { AppProvider } from '@/shared/contexts';

export type ToastFn = (message: string, type?: 'info' | 'error') => void;

/**
 * 测试用 AppProvider wrapper：组件依赖 useAppContext（如 useCopyToClipboard）时，
 * render / renderHook 传入 { wrapper: createAppProviderWrapper() } 即可。
 */
export function createAppProviderWrapper(showToast: ToastFn = () => {}) {
  return function AppProviderWrapper({ children }: { children: ReactNode }) {
    return (
      <AppProvider
        value={{
          config: {} as never,
          customThemes: [],
          agents: [],
          agentInstalledMap: {},
          loading: false,
          ideCommandOverrides: {},
          showToast,
          saveConfig: async () => {},
        }}
      >
        {children}
      </AppProvider>
    );
  };
}
