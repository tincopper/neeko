import React, { createContext, useContext } from 'react';

import type { AgentConfig } from '@/shared/types/agent';
import type { AppConfig, ThemeListItem } from '@/shared/types/settings';

interface AppContextValue {
  /** 只读投影：业务组件不得持有/修改 config，写只经 saveConfig。 */
  config: Readonly<AppConfig>;
  customThemes: ThemeListItem[];
  agents: AgentConfig[];
  agentInstalledMap: Record<string, boolean>;
  loading: boolean;
  ideCommandOverrides: Record<string, string>;
  showToast: (message: string, type?: 'info' | 'error') => void;
  saveConfig: (next: AppConfig) => Promise<void>;
}

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({
  value,
  children,
}: {
  value: AppContextValue;
  children?: React.ReactNode;
}) {
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useAppContext() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useAppContext must be used within AppProvider');
  return ctx;
}

/** 读 config 的推荐入口：只暴露调用方声明需要的那一个字段，避免误把 config 当可写状态。
 *
 * 注意 `Readonly<AppConfig>` 是**浅**只读：顶层字段不可赋值，嵌套对象（`lsp` /
 * `customIdes` …）仍可被改。写侧唯一入口是 `saveConfig`，不要就地修改嵌套值。
 */
export function useConfig<T>(selector: (config: Readonly<AppConfig>) => T): T {
  const { config } = useAppContext();
  return selector(config);
}
