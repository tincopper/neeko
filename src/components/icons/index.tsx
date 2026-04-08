import React from "react";
import {
  GitBranch,
  ChevronRight,
  X,
  Trash2,
  Plus,
  FileCode2,
  Terminal,
  Square,
  Settings,
  AlignJustify,
  Code,
  Grid2x2,
  Info,
  OctagonAlert,
  Search,
  type LucideProps,
} from "lucide-react";

// ─── Lucide aliases (保持现有组件名) ──────────────────────────────────────────

export const BranchIcon = GitBranch;
export const ChevronRightIcon = ChevronRight;
export const TrashIcon = Trash2;
export const PlusIcon = Plus;
export const FileIcon = FileCode2;
export const SideTerminalIcon = Terminal;
export const SettingsIcon = Settings;
export const EditorIcon = AlignJustify;
export const TerminalIcon = Terminal;
export const CodeIcon = Code;
export const GridIcon = Grid2x2;
export const InfoCircleIcon = Info;
export const ErrorOctagonIcon = OctagonAlert;
export const GitLogoIcon = GitBranch;
export const SearchIcon = Search;

// ─── 特殊处理 (定制尺寸/样式) ─────────────────────────────────────────────────

export const CloseIcon: React.FC<LucideProps> = (props) => (
  <X size={14} strokeWidth={1.8} {...props} />
);

export const CloseRoundIcon: React.FC<LucideProps> = (props) => (
  <X size={12} strokeWidth={1.6} {...props} />
);

export const CloseTerminalIcon: React.FC<LucideProps> = (props) => (
  <Square size={10} fill="currentColor" stroke="none" {...props} />
);
