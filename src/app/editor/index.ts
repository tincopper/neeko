// Components
export { default as FileViewer } from "./components/FileViewer";
export { default as HtmlPreview } from "./components/HtmlPreview";
export { default as InlineHtmlPreview } from "./components/InlineHtmlPreview";
export { default as EditorGroupLayout } from "./components/EditorGroupLayout";
export { default as EditorGroupPane } from "./components/EditorGroupPane";
export { default as UnifiedTabBar } from "./components/UnifiedTabBar";
export { default as UnifiedTabItem } from "./components/UnifiedTabItem";

// Hooks
export { useFileView } from "./hooks/useFileView";
export { useFileTabRefresh } from "./hooks/useFileTabRefresh";
export { useTabManagement } from "./hooks/useTabManagement";
export { useEditorGroupLayout } from "./hooks/useEditorGroupLayout";
export type { EditorGroupLayoutResult } from "./hooks/useEditorGroupLayout";
export { useSplitLayout, clampRatio, countPanes, updateSplitRatio } from "./hooks/useSplitLayout";

// Store
export { useEditorStore } from "./store";

// Types
export type {
  TabKind,
  TerminalTabData,
  FileTabData,
  DiffTabData,
  GitLogTabData,
  HtmlPreviewTabData,
  TabData,
  Tab,
  ProjectTabs,
  EditorGroupId,
  EditorGroupState,
  EditorSplitLayout,
  PaneId,
  PaneDirection,
  SplitPathStep,
  PaneNode,
  SplitState,
} from "./types";
export { createDefaultEditorLayout, findGroupIdForTab, oppositeGroup } from "./types";

// Context
export { EditorProvider, useEditorContext } from "./context";
export type { EditorContextValue } from "./context";
export { FileActionsProvider, useFileActionsContext } from "./FileActionsContext";
export type { FileActionsContextValue } from "./FileActionsContext";
