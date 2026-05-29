export type {
  FileNode,
  FileContent,
  FileViewState,
  FileTab,
  FileChangedEvent,
  FileTreeChangedEvent,
} from "./types";
export { DEFAULT_TREE_DEPTH } from "./types";

export { default as FileTree, type TreeNode, buildTree } from "./components/FileTree";
export { default as FilesPanel } from "./components/FilesPanel";
export { useFileStore } from "./store";
