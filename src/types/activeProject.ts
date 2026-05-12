/**
 * activeProject.ts — 统一 Active Project 接口层的类型定义
 *
 * 约束 H5：本文件不得 import 任何 React / Tauri / store / zustand 模块，
 * 仅允许从同目录下其他 types 文件导入。
 */

import type { GitInfo, AheadBehind, CommitEntry, CommitDetail, CommitFileChange, CommitResult, DiffResult } from "./git";
import type { AuthMethod } from "./connection";
import type { FileNode, FileContent } from "./file";

// ────────────────────────────────────────────────────────────────────────────
// 基础类型
// ────────────────────────────────────────────────────────────────────────────

/**
 * ProjectType — 项目类型标识
 * local: 本地文件系统项目
 * wsl:   Windows Subsystem for Linux 项目
 * remote: SSH 远程服务器项目
 */
export type ProjectType = "local" | "wsl" | "remote";

// ────────────────────────────────────────────────────────────────────────────
// ConnectionContext — 判别联合（三变体）
// ────────────────────────────────────────────────────────────────────────────

/** 本地连接上下文：直接使用 projectId 调用命令 */
export interface LocalConnectionContext {
  type: "local";
  /** 本地项目 ID */
  projectId: string;
}

/** WSL 连接上下文：通过 distro 名称与项目路径调用 WSL 命令 */
export interface WslConnectionContext {
  type: "wsl";
  /** WSL 发行版名称，如 "Ubuntu-22.04" */
  distro: string;
  /** WSL 内部项目路径，如 "/home/user/myproject" */
  projectPath: string;
}

/** Remote 连接上下文：通过 SSH 参数调用远程命令 */
export interface RemoteConnectionContext {
  type: "remote";
  /** SSH 主机地址 */
  host: string;
  /** SSH 端口 */
  port: number;
  /** SSH 用户名 */
  username: string;
  /** 认证方式：密码 / 密钥文件 / 带密码的密钥文件 */
  auth: AuthMethod;
  /** 远程项目路径 */
  projectPath: string;
}

/**
 * ConnectionContext — 判别联合，携带建立连接所需的全部参数
 * command factory 通过此类型决定如何构造 invoke 调用
 */
export type ConnectionContext =
  | LocalConnectionContext
  | WslConnectionContext
  | RemoteConnectionContext;

// ────────────────────────────────────────────────────────────────────────────
// UnifiedProjectView — 面板消费的只读统一视图
// ────────────────────────────────────────────────────────────────────────────

/**
 * UnifiedProjectView — 面板组件消费的统一只读视图
 * 不含连接细节，面板只需展示和操作时使用此类型
 */
export interface UnifiedProjectView {
  /** 项目类型 */
  readonly type: ProjectType;
  /**
   * 跨类型唯一 ID
   * local:  直接使用 project.id
   * wsl:    `wsl:{distro}:{path}`
   * remote: `remote:{host}:{path}`
   */
  readonly id: string;
  /** 项目名称 */
  readonly name: string;
  /** 项目路径 */
  readonly path: string;
  /** Git 状态信息，可能为 null（未初始化或加载中） */
  readonly gitInfo: GitInfo | null;
  /** 当前选中的 Agent 名称 */
  readonly selectedAgent: string | null;
  /** 当前选中的 IDE */
  readonly selectedIde: string | null;
}

// ────────────────────────────────────────────────────────────────────────────
// CommitResult（从 git.ts 已有，此处不重新定义）
// ────────────────────────────────────────────────────────────────────────────

// CommitResult, CommitDetail, CommitFileChange 均已在 ./git 中定义，直接复用。

// ────────────────────────────────────────────────────────────────────────────
// ProjectCommands — 完整命令接口（附录 A，共 24 个方法）
// ────────────────────────────────────────────────────────────────────────────

/**
 * ProjectCommands — 项目操作命令接口
 *
 * 面板组件通过此接口调用所有 Git / 文件 / AI 操作，
 * 不直接调用 invoke()，不感知底层传输方式（local / wsl / remote）。
 *
 * 约束 T3：本接口方法集在 Step 1 完成后视为稳定，变更须走 PRD 评审。
 * 方法总数：24 个
 */
export interface ProjectCommands {
  // ── Git Info ─────────────────────────────────────────────────────────────

  /** 刷新并返回最新 Git 状态（分支、变更文件等） */
  refreshGitInfo(): Promise<GitInfo>;

  /** 获取当前分支相对于远程的超前/落后提交数 */
  getAheadBehind(): Promise<AheadBehind>;

  // ── Staging ──────────────────────────────────────────────────────────────

  /** 将指定文件路径加入暂存区（git add） */
  stageFiles(filePaths: string[]): Promise<void>;

  /** 将指定文件路径从暂存区移除（git restore --staged） */
  unstageFiles(filePaths: string[]): Promise<void>;

  /** 丢弃指定文件的工作区变更（git checkout --） */
  discardFile(filePath: string): Promise<void>;

  // ── Commit ───────────────────────────────────────────────────────────────

  /** 提交指定文件（先 stage 再 commit），返回提交结果 */
  commitFiles(filePaths: string[], message: string): Promise<CommitResult>;

  // ── Sync ─────────────────────────────────────────────────────────────────

  /** 拉取所有远程分支的最新引用（git fetch --all） */
  fetch(): Promise<void>;

  /** 拉取当前分支（git pull） */
  pull(): Promise<void>;

  /**
   * 推送当前分支到远程（git push）
   * @param setUpstream 是否设置上游分支（-u 选项）
   */
  push(setUpstream?: boolean): Promise<void>;

  // ── Branch ───────────────────────────────────────────────────────────────

  /** 切换到指定分支（git checkout） */
  checkoutBranch(branchName: string): Promise<void>;

  /**
   * 创建新分支
   * @param startPoint 起始提交或分支，可选
   */
  createBranch(branchName: string, startPoint?: string): Promise<void>;

  /** 删除指定分支（git branch -d） */
  deleteBranch(branchName: string): Promise<void>;

  // ── Log ──────────────────────────────────────────────────────────────────

  /**
   * 获取提交历史列表
   * @param count  返回条数
   * @param skip   跳过条数（用于分页）
   */
  getCommitLog(count: number, skip?: number): Promise<CommitEntry[]>;

  /** 获取单个提交的详细信息 */
  getCommitDetail(commitHash: string): Promise<CommitDetail>;

  /** 获取某次提交涉及的文件变更列表 */
  getCommitFiles(commitHash: string): Promise<CommitFileChange[]>;

  /** 获取某次提交中指定文件的 diff */
  getCommitFileDiff(commitHash: string, filePath: string): Promise<DiffResult>;

  // ── Advanced Git ─────────────────────────────────────────────────────────

  /** Cherry-pick 指定提交到当前分支 */
  cherryPick(commitHash: string): Promise<void>;

  /** Revert 指定提交（git revert --no-edit） */
  revert(commitHash: string): Promise<void>;

  /**
   * 创建 Tag
   * @param message 附注消息，可选
   */
  createTag(tagName: string, message?: string): Promise<void>;

  // ── Files ─────────────────────────────────────────────────────────────────

  /**
   * 读取目录树
   * @param rootPath  根路径，默认使用项目路径
   * @param subPath   子路径，相对于 rootPath
   * @param maxDepth  最大递归深度
   */
  readDirTree(rootPath?: string, subPath?: string, maxDepth?: number): Promise<FileNode[]>;

  /**
   * 读取文件内容
   * @param filePath  文件路径
   * @param rootPath  根路径，默认使用项目路径
   */
  readFileContent(filePath: string, rootPath?: string): Promise<FileContent>;

  /**
   * 写入文件内容（WSL/Remote 下能力受限，capability canEditFiles 为 false 时不应调用）
   * @param filePath  文件路径
   * @param content   文件内容
   * @param rootPath  根路径，默认使用项目路径
   */
  writeFileContent(filePath: string, content: string, rootPath?: string): Promise<void>;

  // ── AI（能力门控） ────────────────────────────────────────────────────────

  /**
   * 根据暂存文件生成 AI commit message
   * （capability canGenerateCommitMessage 为 false 时不应调用）
   */
  generateCommitMessage(filePaths: string[]): Promise<string>;
}

// ────────────────────────────────────────────────────────────────────────────
// ProjectCapabilities — 每个操作一个布尔字段（共 14 个）
// ────────────────────────────────────────────────────────────────────────────

/**
 * ProjectCapabilities — 当前项目支持的能力矩阵
 *
 * 面板通过这些布尔字段控制 UI 元素的可见性与交互性，
 * 不允许在面板中直接判断 ProjectType。
 *
 * 约束 H3：此接口只声明布尔能力，不含条件渲染逻辑或 JSX。
 */
export interface ProjectCapabilities {
  /** 是否可以提交（commit） */
  canCommit: boolean;
  /** 是否可以推送（push） */
  canPush: boolean;
  /** 是否可以拉取（pull） */
  canPull: boolean;
  /** 是否可以 fetch */
  canFetch: boolean;
  /** 是否可以暂存文件（stage） */
  canStage: boolean;
  /** 是否可以丢弃变更（discard） */
  canDiscard: boolean;
  /** 是否可以查看 Git 日志 */
  canViewLog: boolean;
  /** 是否可以 cherry-pick */
  canCherryPick: boolean;
  /** 是否可以 revert 提交 */
  canRevert: boolean;
  /** 是否可以创建 Tag */
  canCreateTag: boolean;
  /** 是否可以浏览文件树 */
  canBrowseFiles: boolean;
  /** 是否可以编辑文件（WSL/Remote 为 false） */
  canEditFiles: boolean;
  /** 是否可以使用 AI 生成 commit message（WSL/Remote 为 false） */
  canGenerateCommitMessage: boolean;
  /** 是否可以管理 PR（WSL/Remote 为 false） */
  canManagePRs: boolean;
}

// ────────────────────────────────────────────────────────────────────────────
// ActiveProjectContext — 对外暴露的完整 context
// ────────────────────────────────────────────────────────────────────────────

/**
 * ActiveProjectContext — useActiveProject() hook 的返回类型
 *
 * 面板组件通过解构此对象获取所有需要的数据和命令，
 * 无需直接访问 store 或 invoke()。
 */
export interface ActiveProjectContext {
  /** 统一项目视图，project 为 null 表示当前无活跃项目 */
  project: UnifiedProjectView | null;
  /** 项目命令集，project 为 null 时此字段也为 null */
  commands: ProjectCommands | null;
  /** 项目能力矩阵，project 为 null 时此字段也为 null */
  capabilities: ProjectCapabilities | null;
  /** 连接上下文（含底层连接参数），project 为 null 时此字段也为 null */
  connectionContext: ConnectionContext | null;
  /** 当前活跃 Worktree 路径，未使用 worktree 时为 null */
  worktreePath: string | null;
  /** 是否正在加载项目数据 */
  isLoading: boolean;
}
