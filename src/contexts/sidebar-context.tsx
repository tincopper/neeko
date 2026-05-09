import React, { createContext, useCallback, useContext, useState } from "react";

export type ActivityPanel = "projects" | "skills" | "files";

interface SidebarContextValue {
  activePanel: ActivityPanel | null;
  togglePanel: (panel: ActivityPanel) => void;
}

const SidebarContext = createContext<SidebarContextValue | null>(null);

interface SidebarProviderProps {
  initialPanel?: ActivityPanel;
  children: React.ReactNode;
}

/**
 * Sidebar panel visibility context.
 *
 * Resize logic (panelWidth, onPanelResizeStart, CSS var writes) removed in
 * Phase 3 — replaced by react-resizable-panels via DockLayout.
 *
 * Kept for backward compatibility during migration.
 */
export function SidebarProvider({
  initialPanel = "projects",
  children,
}: SidebarProviderProps) {
  const [activePanel, setActivePanel] = useState<ActivityPanel | null>(initialPanel);

  const togglePanel = useCallback((panel: ActivityPanel) => {
    setActivePanel((prev) => (prev === panel ? null : panel));
  }, []);

  return (
    <SidebarContext.Provider value={{ activePanel, togglePanel }}>
      {children}
    </SidebarContext.Provider>
  );
}

export function useSidebar() {
  const ctx = useContext(SidebarContext);
  if (!ctx) throw new Error("useSidebar must be used within SidebarProvider");
  return ctx;
}
