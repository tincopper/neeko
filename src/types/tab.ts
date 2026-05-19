import type { DiffSource, ViewMode } from "../components/diff/types";
import type { FileContent } from "./file";

/** Tab 类型标签 */
export type TabKind = "terminal" | "file" | "diff" | "settings" | "gitLog" | "html-preview";

/** 终端 Tab 数据 */
export interface TerminalTabData {
  kind: "terminal";
  agentId: string | null;
  status: "Idle" | "Running" | "Failed";
  /** If set, the terminal spawns this command directly (task mode) instead of a shell */
  taskCommand?: string;
  /** Config ID of the associated task — used to notify taskStore on process exit */
  taskConfigId?: string;
  /**
   * Incremented each time a finished task tab is reused.
   * TerminalView watches this as a useEffect dep to destroy stale cache and
   * create a fresh terminal session (clean slate, no old output).
   */
  rebuildKey?: number;
}

/** 文件 Tab 数据 */
export interface FileTabData {
  kind: "file";
  filePath: string;
  fileName: string;
  content: FileContent;
  isDirty: boolean;
  /** 文件已被外部修改（watcher 检测到），等待用户决策 */
  externallyModified?: boolean;
}

/** Diff Tab 数据 */
export interface DiffTabData {
  kind: "diff";
  filePath: string;
  fileName: string;
  diffSource: DiffSource;
  initialMode?: ViewMode;
}

/** Settings Tab 数据 */
export interface SettingsTabData {
  kind: "settings";
}

/** Git Log Tab 数据 */
export interface GitLogTabData {
  kind: "gitLog";
}

/** HTML 预览 Tab 数据 */
export interface HtmlPreviewTabData {
  kind: "html-preview";
  filePath: string;
  fileName: string;
}

/** Tab 数据联合类型 */
export type TabData = TerminalTabData | FileTabData | DiffTabData | SettingsTabData | GitLogTabData | HtmlPreviewTabData;

/** 统一 Tab 接口 */
export interface Tab {
  id: string;
  projectId: string;
  title: string;
  order: number;
  data: TabData;
}

/** Per-project tab 状态 */
export interface ProjectTabs {
  tabs: Tab[];
  activeTabId: string | null;
}
