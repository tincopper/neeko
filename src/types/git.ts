export interface FileChange {
  path: string;
  status: "Modified" | "Added" | "Deleted" | "Renamed" | "Untracked";
  additions: number;
  deletions: number;
}

export interface Worktree {
  path: string;
  branch: string;
  head: string;
}

export interface GitInfo {
  current_branch: string;
  branches: string[];
  worktrees: Worktree[];
  changed_files: FileChange[];
  is_clean: boolean;
}

// Git 提交信息
export interface CommitInfo {
  hash: string;
  short_hash: string;
  message: string;
  author: string;
  email: string;
  timestamp: number;
  date: string;
  parent_hashes: string[];
}

// Git 分支分组
export interface BranchGroup {
  local: string[];
  remote: string[];
  tags: string[];
  current: string;
}

// 单个提交详情（含修改文件列表）
export interface CommitDetail {
  commit: CommitInfo;
  files: FileChange[];
  parent_hashes: string[];
}
