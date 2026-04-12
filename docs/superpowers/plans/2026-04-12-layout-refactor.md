# Layout Refactor: shadcn/ui Sidebar Pattern

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor Neeko's layout from "App.tsx prop drilling 51 props to Sidebar" to "SidebarProvider context + Sidebar primitive component", reducing coupling and improving maintainability.

**Architecture:** Introduce a `SidebarProvider` context to manage sidebar width and resize state. Create a `Sidebar` UI primitive that reads from context. Reduce ProjectSidebar props from 51 to ~15 by moving shared state (config, agents, loading, IDE overrides) to context. MainContent gets the same treatment.

**Tech Stack:** React Context, Radix UI Slot, Tailwind CSS v4, existing cn() utility

---

## Current State Analysis

### Problem: Prop Drilling

```
App.tsx (15 hooks)
  ├── ProjectSidebar: 51 props (3 project types x ~17 callbacks each)
  └── MainContent: 26 props (3 project types x ~8 state values each)
```

### Target State

```
App.tsx (15 hooks, unchanged)
  └── SidebarProvider (new context: sidebar width + resize)
      ├── AppSidebar: ~15 props (only project data, no config/agents)
      └── MainContent: ~15 props (only active project state)
```

### Key Context: `AppContext`

Shared state that both Sidebar and MainContent need: `config`, `agents`, `agentInstalledMap`, `loading`, `ideCommandOverrides`, `showToast`.

---

## File Structure

```
src/
├── context/
│   ├── app-context.tsx        (NEW) shared app state context
│   └── sidebar-context.tsx    (NEW) sidebar width/resize context
├── components/
│   ├── ui/
│   │   └── sidebar.tsx        (NEW) Sidebar layout primitive
│   ├── layout/
│   │   ├── AppSidebar.tsx     (NEW) wraps ProjectSidebar, reads context
│   │   └── ...
│   └── project/
│       └── ProjectSidebar.tsx (MODIFY) reduce props
├── App.tsx                    (MODIFY) wrap with providers, reduce props passed
```

---

## Task 1: Create AppContext

**Files:**
- Create: `src/context/app-context.tsx`

Shared state that multiple components need but is not project-specific.

```tsx
// src/context/app-context.tsx
import React, { createContext, useContext } from "react";
import type { AppConfig, AgentConfig } from "../types";

interface AppContextValue {
  config: AppConfig;
  agents: AgentConfig[];
  agentInstalledMap: Record<string, boolean>;
  loading: boolean;
  ideCommandOverrides: Record<string, string>;
  showToast: (message: string, type?: "info" | "error") => void;
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
```

**Verify:**
- [ ] `npx tsc --noEmit` passes

---

## Task 2: Create SidebarContext

**Files:**
- Create: `src/context/sidebar-context.tsx`

Manages sidebar width (persisted to Tauri backend) and resize interaction state.

```tsx
// src/context/sidebar-context.tsx
import React, { createContext, useContext, useCallback, useRef, useState } from "react";

const MIN_WIDTH = 180;
const MAX_WIDTH = 480;

interface SidebarContextValue {
  sidebarWidth: number;
  setSidebarWidth: (w: number) => void;
  onSidebarWidthChange?: (w: number) => void;
  suppressResizeRef: React.MutableRefObject<boolean>;
  /** Start resize drag. Called from sidebar resize handle. */
  onResizeStart: (e: React.MouseEvent) => void;
}

const SidebarContext = createContext<SidebarContextValue | null>(null);

interface SidebarProviderProps {
  initialWidth?: number;
  onWidthPersist?: (w: number) => void;
  children: React.ReactNode;
}

export function SidebarProvider({ initialWidth = 280, onWidthPersist, children }: SidebarProviderProps) {
  const [width, setWidth] = useState(initialWidth);
  const suppressResizeRef = useRef(false);

  // Sync CSS variable
  const updateWidth = useCallback((w: number) => {
    const clamped = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, w));
    setWidth(clamped);
    document.documentElement.style.setProperty("--sidebar-width", `${clamped}px`);
  }, []);

  // Initialize CSS variable when initialWidth changes
  React.useEffect(() => {
    if (initialWidth) {
      document.documentElement.style.setProperty("--sidebar-width", `${Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, initialWidth))}px`);
    }
  }, [initialWidth]);

  const onResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = width;
    suppressResizeRef.current = true;

    const onMouseMove = (ev: MouseEvent) => {
      updateWidth(startWidth + (ev.clientX - startX));
    };
    const onMouseUp = () => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      suppressResizeRef.current = false;
      if (onWidthPersist) onWidthPersist(width);
    };

    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  }, [width, updateWidth, onWidthPersist]);

  return (
    <SidebarContext.Provider
      value={{
        sidebarWidth: width,
        setSidebarWidth: updateWidth,
        onSidebarWidthChange: onWidthPersist,
        suppressResizeRef,
        onResizeStart,
      }}
    >
      {children}
    </SidebarContext.Provider>
  );
}

export function useSidebar() {
  const ctx = useContext(SidebarContext);
  if (!ctx) throw new Error("useSidebar must be used within SidebarProvider");
  return ctx;
}
```

**Verify:**
- [ ] `npx tsc --noEmit` passes

---

## Task 3: Create Sidebar UI Primitive

**Files:**
- Create: `src/components/ui/sidebar.tsx`

Layout primitive that handles the sidebar structure + resize handle. Reads from `useSidebar()` context.

```tsx
// src/components/ui/sidebar.tsx
import * as React from "react";
import { cn } from "../../utils/cn";
import { useSidebar } from "../../context/sidebar-context";

function SidebarRoot({ className, children, ...props }: React.ComponentProps<"div">) {
  const { onResizeStart } = useSidebar();
  return (
    <div className={cn("sidebar", className)} {...props}>
      <div
        className="absolute top-0 right-[-3px] w-1.5 h-full cursor-col-resize z-10 hover:bg-accent-blue/50 active:bg-accent-blue/50"
        onMouseDown={onResizeStart}
      />
      {children}
    </div>
  );
}

function SidebarContent({ className, children, ...props }: React.ComponentProps<"div">) {
  return (
    <div className={cn("flex-1 overflow-y-auto py-1.5", className)} {...props}>
      {children}
    </div>
  );
}

function SidebarFooter({ className, children, ...props }: React.ComponentProps<"div">) {
  return (
    <div className={cn("border-t border-border", className)} {...props}>
      {children}
    </div>
  );
}

export { SidebarRoot, SidebarContent, SidebarFooter };
```

**Verify:**
- [ ] `npx tsc --noEmit` passes

---

## Task 4: Wire Providers in App.tsx

**Files:**
- Modify: `src/App.tsx`

Wrap the render tree with `AppProvider` and `SidebarProvider`. Remove the resize-related props from ProjectSidebar.

```tsx
// In App.tsx render, wrap with providers:

return (
  <div className="w-screen h-screen flex flex-col">
    <TitleBar ... />

    <AppProvider value={{
      config,
      agents,
      agentInstalledMap,
      loading,
      ideCommandOverrides: config.ideCommandOverrides ?? {},
      showToast,
    }}>
      <SidebarProvider
        initialWidth={initialSidebarWidth}
        onWidthPersist={session.saveSidebarWidth}
      >
        <div className="flex flex-1 min-h-0 w-screen relative">
          <ProjectSidebar
            projects={projects}
            activeProjectId={activeProjectId}
            wslEntries={wslEntries}
            remoteEntries={remoteEntries}
            activeWslKey={activeWslKey}
            activeRemoteKey={activeRemoteKey}
            wslOpenSessions={wslOpenSessions}
            remoteOpenSessions={remoteOpenSessions}
            onAddProject={handleAddProject}
            onRemoveProject={handleRemoveProject}
            onSelectProject={handleSelectProjectWithClear}
            onSelectFile={handleSelectFile}
            onRefreshGit={handleRefreshGit}
            onBackToMainTerminal={callbacks.handleBackToMainTerminal}
            onOpenSettings={callbacks.handleToggleSettings}
            onOpenIde={callbacks.handleOpenIdeForSidebar}
            onOpenSideTerminal={sideTerminal.handleOpenSideTerminal}
            onOpenWorktreeTerminal={callbacks.handleOpenWorktreeTerminal}
            onSelectWorktreeFile={callbacks.handleSelectWorktreeFile}
            onSelectWslProject={wslActions.handleSelectWslProject}
            onCloseWslProject={handleCloseWslProject}
            onRemoveWslProject={handleRemoveWslProject}
            onRemoveWslEntry={handleRemoveWslEntry}
            onAddWslProject={handleAddWslProject}
            onSelectRemoteProject={remoteActions.handleSelectRemoteProject}
            onCloseRemoteProject={handleCloseRemoteProject}
            onRemoveRemoteProject={handleRemoveRemoteProject}
            onRemoveRemoteEntry={handleRemoveRemoteEntry}
            onAddRemoteProject={handleAddRemoteProject}
            onOpenWslSideTerminal={sideTerminal.handleOpenWslSideTerminal}
            onOpenRemoteSideTerminal={sideTerminal.handleOpenRemoteSideTerminal}
            onSelectWslFile={wslActions.handleSelectWslFile}
            onSelectRemoteFile={remoteActions.handleSelectRemoteFile}
            onRefreshWslGit={wslActions.handleRefreshWslGit}
            onRefreshRemoteGit={remoteActions.handleRefreshRemoteGit}
            onOpenWslIde={wslActions.handleOpenWslIde}
            onOpenRemoteIde={remoteActions.handleOpenRemoteIde}
            onOpenWslWorktreeTerminal={wslActions.handleOpenWslWorktreeTerminal}
            onOpenRemoteWorktreeTerminal={wslActions.handleOpenRemoteWorktreeTerminal}
            invokeRemoteGit={remoteActions.invokeRemoteGit}
            onDragEnd={handleDragEnd}
            onShowToast={showToast}
            // REMOVED: initialSidebarWidth, onSidebarWidthChange, suppressResizeRef
            // REMOVED: loading, ideCommandOverrides, agents, config
          />

          <MainContent ... />
        </div>

        {settingsOpen && <SettingsPanel ... />}
        {/* other modals */}
      </SidebarProvider>
    </AppProvider>

    <AppToast toast={toast} />
  </div>
);
```

**Verify:**
- [ ] `npx tsc --noEmit` passes
- [ ] `pnpm test` passes

---

## Task 5: Update ProjectSidebar to Read Context

**Files:**
- Modify: `src/components/project/ProjectSidebar.tsx`

Replace props with context reads:
- Remove from props interface: `initialSidebarWidth`, `onSidebarWidthChange`, `suppressResizeRef`, `loading`, `ideCommandOverrides`, `agents`, `config`
- Read these from `useAppContext()` and `useSidebar()`
- Use `SidebarRoot` / `SidebarContent` from the UI primitive
- Remove the resize handle JSX (now inside SidebarRoot)

```tsx
// ProjectSidebar.tsx — before
interface ProjectSidebarProps {
  // ... 51 props
}

// ProjectSidebar.tsx — after
interface ProjectSidebarProps {
  projects: Project[];
  activeProjectId: string | null;
  wslEntries: WSLEntrySession[];
  remoteEntries: RemoteEntrySession[];
  // ... all callback props (~35 remain)
  onDragEnd?: (draggedId: string, targetId: string) => void;
  // REMOVED: initialSidebarWidth, onSidebarWidthChange, suppressResizeRef
  // REMOVED: loading, ideCommandOverrides, agents, config, onShowToast
}
```

Inside component body:
```tsx
const { config, agents, loading, ideCommandOverrides, showToast } = useAppContext();
const { suppressResizeRef } = useSidebar();
```

Replace the wrapper div:
```tsx
// Before
<div className="sidebar">
  <div className="sidebar-resize-handle ..." onMouseDown={onMouseDown} />
  <div className="project-list ...">
</div>

// After
<SidebarRoot>
  <SidebarContent>
    {/* project list content */}
  </SidebarContent>
</SidebarRoot>
```

Remove: `onMouseDown`, `isDragging`, `startX`, `startWidth`, `updateWidth`, `onMouseDown` handler, `useEffect` for CSS var init — all moved to SidebarContext.

**Verify:**
- [ ] `npx tsc --noEmit` passes
- [ ] `pnpm test` passes

---

## Task 6: Update MainContent to Read Context

**Files:**
- Modify: `src/components/MainContent.tsx`

Replace `config` prop with context read:

```tsx
// Before
interface MainContentProps {
  config: AppConfig;
  // ... 25 other props
}

// After
interface MainContentProps {
  // config removed, read from useAppContext()
  activeProject: Project | null;
  // ... remaining props
}
```

Inside component body:
```tsx
const { config } = useAppContext();
```

Update App.tsx: remove `config={config}` from `<MainContent>`.

**Verify:**
- [ ] `npx tsc --noEmit` passes
- [ ] `pnpm test` passes

---

## Task 7: Update Dialog Components to Read Context

**Files:**
- Modify: `src/App.tsx` (reduce dialog props)
- Modify: `src/components/SettingsPanel.tsx` (read config from context)
- Modify: `src/components/project/AddProjectModal.tsx` (read from context)
- Modify: `src/components/connections/WSLDialog.tsx` (read from context)
- Modify: `src/components/connections/RemoteDialog.tsx` (read from context)

Each dialog currently receives `agents` and `config` as props. Replace with `useAppContext()`.

For each dialog component:
1. Add `import { useAppContext } from "../../context/app-context"`
2. Remove `agents` and `config` from props interface
3. Read from context: `const { agents, config } = useAppContext()`
4. Remove `agents={agents}` and `config={config}` from the JSX in App.tsx

**Verify:**
- [ ] `npx tsc --noEmit` passes
- [ ] `pnpm test` passes
- [ ] `pnpm build` passes

---

## Task 8: Add ui/sidebar.tsx to barrel export

**Files:**
- Modify: `src/components/ui/index.ts`

Add:
```ts
export { SidebarRoot, SidebarContent, SidebarFooter } from "./sidebar";
```

**Verify:**
- [ ] `npx tsc --noEmit` passes

---

## Final Verification

- [ ] `npx tsc --noEmit` — 0 errors
- [ ] `pnpm test` — 199 tests passing
- [ ] `pnpm build` — builds successfully
- [ ] Manual test: sidebar resize drag works
- [ ] Manual test: project add/remove/select works
- [ ] Manual test: WSL/SSH dialogs open correctly
- [ ] Manual test: settings panel opens correctly

---

## Summary of Changes

| Metric | Before | After |
|--------|--------|-------|
| ProjectSidebar props | 51 | ~35 |
| MainContent props | 26 | ~25 |
| Context providers | 0 | 2 (App + Sidebar) |
| Layout abstraction | None | SidebarRoot/Content/Footer |
| Resize logic location | Inline in ProjectSidebar | SidebarContext |
| Config/agents/IDE passing | Props everywhere | Context reads |
