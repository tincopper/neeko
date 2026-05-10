import type { DiffSource, ViewMode } from "../components/diff/types";
import type { FileContent } from "./file";

/** Tab 类型标签 */
export type TabKind = "terminal" | "file" | "diff" | "settings" | "gitLog";

/** 终端 Tab 数据 */
export interface TerminalTabData {
  kind: "terminal";
  agentId: string | null;
  status: "Idle" | "Running" | "Failed";
}

/** 文件 Tab 数据 */
export interface FileTabData {
  kind: "file";
  filePath: string;
  fileName: string;
  content: FileContent;
  isDirty: boolean;
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

/** Tab 数据联合类型 */
export type TabData = TerminalTabData | FileTabData | DiffTabData | SettingsTabData | GitLogTabData;

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
