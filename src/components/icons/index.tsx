import React from "react";

// ─── Lucide aliases (semantic names for commonly used icons) ─────────────
export {
  GitBranch as BranchIcon,
  ChevronRight as ChevronRightIcon,
  Trash2 as TrashIcon,
  Plus as PlusIcon,
  FileCode2 as FileIcon,
  FolderGit2 as FolderGitIcon,
  Folder as FolderIcon,
  Settings as SettingsIcon,
  AlignJustify as EditorIcon,
  Terminal as TerminalIcon,
  Code as CodeIcon,
  Grid2x2 as GridIcon,
  Info as InfoCircleIcon,
  OctagonAlert as ErrorOctagonIcon,
  GitBranch as GitLogoIcon,
  Search as SearchIcon,
  Sun as AppearanceIcon,
  Keyboard as KeyboardIcon,
  MoreVertical as MoreVerticalIcon,
  Server as ServerIcon,
} from "lucide-react";

// ─── Re-export everything so all lucide icons importable from one path ───
export * from "lucide-react";

// ─── Special overrides (custom size/style) ───────────────────────────────
import { X, Square, ChevronLeft, type LucideProps } from "lucide-react"

export const CloseIcon: React.FC<LucideProps> = (props) => (
  <X size={14} strokeWidth={1.8} {...props} />
);

export const CloseRoundIcon: React.FC<LucideProps> = (props) => (
  <X size={12} strokeWidth={1.6} {...props} />
);

export const CloseTerminalIcon: React.FC<LucideProps> = (props) => (
  <Square size={10} fill="currentColor" stroke="none" {...props} />
);

export const ArrowLeftIcon: React.FC<LucideProps> = (props) => (
  <ChevronLeft strokeWidth={1.8} {...props} />
);