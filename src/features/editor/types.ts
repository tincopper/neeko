export type {
  TabKind,
  TerminalTabData,
  FileTabData,
  DiffTabData,
  HtmlPreviewTabData,
  ConversationTabData,
  PRDetailTabData,
  TabData,
  Tab,
  ProjectTabs,
} from '@/shared/types/tab';
export type {
  EditorGroupId,
  EditorGroupState,
  EditorSplitLayout,
} from '@/shared/types/editorGroup';
export {
  createDefaultEditorLayout,
  findGroupIdForTab,
  oppositeGroup,
} from '@/shared/types/editorGroup';
export type {
  PaneId,
  PaneDirection,
  SplitPathStep,
  PaneNode,
  SplitState,
} from '@/shared/types/split';
