import React, { createContext, useContext } from 'react';

import type { DockViewMeta } from '@/shared/dock';

/**
 * UI-facing dock view definition injected by app.
 * layout consumes this via context and never imports features/app registries.
 */
export interface DockViewDef extends DockViewMeta {
  title: string;
  icon: string;
  /** `host !== 'none'` 的视图必填（buildDockPanelRegistry 的 fail-fast 校验）。 */
  component?: React.LazyExoticComponent<React.ComponentType<Record<string, unknown>>>;
  minPanelSize?: number;
}

export type DockViewRegistry = Record<string, DockViewDef>;

const DockRegistryContext = createContext<DockViewRegistry | null>(null);

export interface DockRegistryProviderProps {
  registry: DockViewRegistry;
  children?: React.ReactNode;
}

export function DockRegistryProvider({ registry, children }: DockRegistryProviderProps) {
  return <DockRegistryContext.Provider value={registry}>{children}</DockRegistryContext.Provider>;
}

export function useDockRegistry(): DockViewRegistry {
  const registry = useContext(DockRegistryContext);
  if (!registry) {
    throw new Error('useDockRegistry must be used within DockRegistryProvider');
  }
  return registry;
}
