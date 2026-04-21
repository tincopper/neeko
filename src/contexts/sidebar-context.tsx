import React, { createContext, useCallback, useContext, useState } from "react";

export type ActivityPanel = "projects" | "skills" | "files";

const PANEL_MIN = 180;
const PANEL_MAX = 480;
const PANEL_DEFAULT = 280;

interface SidebarContextValue {
  activePanel: ActivityPanel | null;
  togglePanel: (panel: ActivityPanel) => void;
  panelWidth: number;
  onPanelResizeStart: (e: React.MouseEvent) => void;
}

const SidebarContext = createContext<SidebarContextValue | null>(null);

interface SidebarProviderProps {
  initialPanel?: ActivityPanel;
  initialPanelWidth?: number;
  onPanelWidthPersist?: (w: number) => void;
  children: React.ReactNode;
}

export function SidebarProvider({
  initialPanel = "projects",
  initialPanelWidth = PANEL_DEFAULT,
  onPanelWidthPersist,
  children,
}: SidebarProviderProps) {
  const [activePanel, setActivePanel] = useState<ActivityPanel | null>(initialPanel);
  const [panelWidth, setPanelWidth] = useState(initialPanelWidth);

  const togglePanel = useCallback((panel: ActivityPanel) => {
    setActivePanel((prev) => (prev === panel ? null : panel));
  }, []);

  const onPanelResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const startX = e.clientX;
      const startWidth = panelWidth;

      const onMouseMove = (ev: MouseEvent) => {
        const next = Math.min(PANEL_MAX, Math.max(PANEL_MIN, startWidth + (ev.clientX - startX)));
        setPanelWidth(next);
        document.documentElement.style.setProperty("--panel-width", `${next}px`);
      };
      const onMouseUp = () => {
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", onMouseUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        if (onPanelWidthPersist) {
          onPanelWidthPersist(Math.min(PANEL_MAX, Math.max(PANEL_MIN, panelWidth)));
        }
      };

      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
    },
    [panelWidth, onPanelWidthPersist]
  );

  React.useEffect(() => {
    document.documentElement.style.setProperty("--panel-width", `${panelWidth}px`);
  }, [panelWidth]);

  return (
    <SidebarContext.Provider value={{ activePanel, togglePanel, panelWidth, onPanelResizeStart }}>
      {children}
    </SidebarContext.Provider>
  );
}

export function useSidebar() {
  const ctx = useContext(SidebarContext);
  if (!ctx) throw new Error("useSidebar must be used within SidebarProvider");
  return ctx;
}
