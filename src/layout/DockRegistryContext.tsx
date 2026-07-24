import React, { createContext, useContext } from 'react';

import type { DockPanelMeta } from '@/shared/dock';

/**
 * UI-facing dock panel definition injected by app.
 * layout consumes this via context and never imports features/app registries.
 */
export interface DockPanelViewDef extends DockPanelMeta {
  title: string;
  icon: string;
  component?: React.LazyExoticComponent<React.ComponentType<Record<string, unknown>>>;
  minPanelSize?: number;
}

export type DockPanelRegistry = Record<string, DockPanelViewDef>;

const DockRegistryContext = createContext<DockPanelRegistry | null>(null);

export interface DockRegistryProviderProps {
  registry: DockPanelRegistry;
  children: React.ReactNode;
}

export function DockRegistryProvider({ registry, children }: DockRegistryProviderProps) {
  return <DockRegistryContext.Provider value={registry}>{children}</DockRegistryContext.Provider>;
}

export function useDockRegistry(): DockPanelRegistry {
  const registry = useContext(DockRegistryContext);
  if (!registry) {
    throw new Error('useDockRegistry must be used within DockRegistryProvider');
  }
  return registry;
}
