// Components
export { default as FileViewer } from "./components/FileViewer";
export { default as HtmlPreview } from "./components/HtmlPreview";
export { default as InlineHtmlPreview } from "./components/InlineHtmlPreview";
export { default as EditorGroupLayout } from "./components/EditorGroupLayout";
export { default as EditorGroupPane } from "./components/EditorGroupPane";
export { default as TabBar } from "./components/TabBar";
export { default as TabItem } from "./components/TabItem";

// Hooks
export { useFileView } from "./hooks/useFileView";
export { useFileTabRefresh } from "./hooks/useFileTabRefresh";
export { useTabManagement } from "./hooks/useTabManagement";
export { useEditorGroupLayout } from "./hooks/useEditorGroupLayout";
export type { EditorGroupLayoutResult } from "./hooks/useEditorGroupLayout";
export { useSplitLayout, clampRatio, countPanes, updateSplitRatio } from "@/shared/hooks";

// Navigation history (IDEA-like Back / Forward)
export {
  useNavHistoryStore,
  captureCurrentNavLocation,
  recordNavigationJump,
} from "./navigationHistoryStore";
export type { NavLocation } from "./navigationHistory";
export { createNavigationHistory } from "./navigationHistory";

// Store
export { useEditorStore } from "@/shared/store";

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
export { EditorProvider, useEditorContext } from "@/shared/contexts";
export type { EditorContextValue } from "@/shared/contexts";
export { FileActionsProvider, useFileActionsContext } from "./FileActionsContext";
export type { FileActionsContextValue } from "./FileActionsContext";
