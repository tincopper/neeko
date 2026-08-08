import React from 'react';

import { ChevronsDownUp, Crosshair } from '@/shared/components/icons';
import { fileIconSrc } from '@/shared/utils/fileIcons';

interface FilesPanelHeaderProps {
  projectName: string | null;
  projectPath?: string | null;
  /** 当前打开的文件名（非空时头部展示文件而非项目） */
  activeFileName: string | null;
  /** 当前打开的文件相对路径 */
  activeFilePath: string | null;
  /** 展示用项目路径（home 前缀已替换为 ~） */
  displayPath: string | null;
  /** 在默认新建目录内新建文件 */
  onCreateFile?: () => void;
  /** 在默认新建目录内新建目录 */
  onCreateDirectory?: () => void;
  onCollapseAll: () => void;
  /** 是否有可折叠的已展开目录 */
  canCollapse: boolean;
  onRefresh: () => void;
  /** 定位当前编辑器 file tab 到文件树（刷新按钮左侧）。未提供则不渲染。 */
  onLocateFile?: () => void;
  /** 当前是否有 file tab 打开（无则按钮置灰） */
  canLocateFile?: boolean;
}

/** 文件面板头部：第一行项目名/文件名 + 按钮组；第二行路径独占一行 */
function FilesPanelHeader({
  projectName,
  projectPath,
  activeFileName,
  activeFilePath,
  displayPath,
  onCreateFile,
  onCreateDirectory,
  onCollapseAll,
  canCollapse,
  onRefresh,
  onLocateFile,
  canLocateFile = false,
}: FilesPanelHeaderProps) {
  return (
    <div className="px-3 py-2 flex flex-col gap-1">
      <div className="flex items-center justify-between gap-2 min-w-0">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          {activeFileName ? (
            <>
              <img
                src={fileIconSrc(activeFileName)}
                alt=""
                width={16}
                height={16}
                className="shrink-0"
              />
              <span className="font-semibold text-[var(--font-size)] truncate">
                {activeFileName}
              </span>
            </>
          ) : (
            <span className="text-[var(--font-size)] font-medium text-text-primary truncate">
              {projectName}
            </span>
          )}
        </div>
        <div className="flex items-center gap-0.5 shrink-0">
          {onCreateFile && (
            <button
              className="p-1 rounded hover:bg-bg-hover text-text-secondary hover:text-text-primary transition-colors"
              onClick={onCreateFile}
              title="New File"
              aria-label="New File"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <path d="M14 2v6h6" />
                <path d="M12 11v6M9 14h6" />
              </svg>
            </button>
          )}
          {onCreateDirectory && (
            <button
              className="p-1 rounded hover:bg-bg-hover text-text-secondary hover:text-text-primary transition-colors"
              onClick={onCreateDirectory}
              title="New Folder"
              aria-label="New Folder"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                <path d="M12 11v6M9 14h6" />
              </svg>
            </button>
          )}
          <button
            className="p-1 rounded hover:bg-bg-hover text-text-secondary hover:text-text-primary transition-colors disabled:opacity-40 disabled:hover:bg-transparent disabled:cursor-not-allowed"
            onClick={onCollapseAll}
            disabled={!canCollapse}
            title="Collapse All"
            aria-label="Collapse All"
          >
            <ChevronsDownUp size={14} />
          </button>
          {onLocateFile && (
            <button
              className="p-1 rounded hover:bg-bg-hover text-text-secondary hover:text-text-primary transition-colors disabled:opacity-40 disabled:hover:bg-transparent disabled:cursor-not-allowed"
              onClick={onLocateFile}
              disabled={!canLocateFile}
              title="Locate current file"
              aria-label="Locate current file"
            >
              <Crosshair size={14} />
            </button>
          )}
          <button
            className="p-1 rounded hover:bg-bg-hover text-text-secondary hover:text-text-primary transition-colors"
            onClick={onRefresh}
            title="Refresh file tree"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M21.5 2v6h-6" />
              <path d="M2.5 22v-6h6" />
              <path d="M2 11.5a10 10 0 0 1 18.8-4.3" />
              <path d="M22 12.5a10 10 0 0 1-18.8 4.2" />
            </svg>
          </button>
        </div>
      </div>
      {/* 路径独占一行，避免被按钮遮挡 */}
      <div className="min-w-0">
        {activeFileName ? (
          <span className="block text-[calc(var(--font-size)-1px)] text-text-muted truncate">
            {activeFilePath}
          </span>
        ) : projectPath ? (
          <span
            className="block text-[calc(var(--font-size)-1px)] text-text-muted truncate"
            title={projectPath}
          >
            {displayPath}
          </span>
        ) : null}
      </div>
    </div>
  );
}

export default React.memo(FilesPanelHeader);
