import React, { createContext, useContext } from "react";
import type { AppConfig, ThemeListItem } from '@/features/settings/types';
import type { AgentConfig } from '@/features/agent/types';

interface AppContextValue {
  config: AppConfig;
  customThemes: ThemeListItem[];
  agents: AgentConfig[];
  agentInstalledMap: Record<string, boolean>;
  loading: boolean;
  ideCommandOverrides: Record<string, string>;
  showToast: (message: string, type?: "info" | "error") => void;
  saveConfig: (next: AppConfig) => Promise<void>;
}

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({
  value,
  children,
}: {
  value: AppContextValue;
  children: React.ReactNode;
}) {
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useAppContext() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useAppContext must be used within AppProvider");
  return ctx;
}
