import React, { useMemo } from 'react';
import { useShallow } from 'zustand/shallow';

import { FileCode } from '@/shared/components/icons';
import { useEditorContext } from '@/shared/contexts';
import { useAppContext } from '@/shared/contexts/AppContext';
import { useEditorStore } from '@/shared/store/editorStore';
import { useProjectStore } from '@/shared/store/projectStore';
import { useWorktreeStore } from '@/shared/store/worktreeStore';
import type { Tab, FileTabData } from '@/shared/types';
import { isFileTab } from '@/shared/utils/fileTree';
import { resolveTabKey } from '@/shared/utils/tabKey';

import { useFileActionsContext } from '../FileActionsContext';

import FileEditor from './FileEditor';

/** Convert a unified Tab (file kind) to legacy FileTab for FileEditor */
function tabToFileTab(tab: Tab & { data: FileTabData }): import('@/shared/types').FileTab {
  return {
    id: tab.id,
    projectId: tab.projectId,
    filePath: tab.data.filePath,
    fileName: tab.data.fileName,
    content: tab.data.content,
    isDirty: tab.data.isDirty,
    order: tab.order,
    initialPreviewMode: tab.data.initialPreviewMode,
    isUntitled: tab.data.isUntitled,
    untitledName: tab.data.untitledName,
  };
}

/**
 * 文件编辑器容器：读取项目 tab 状态，为每个文件 tab 渲染 FileEditor，
 * 保持所有编辑器存活以便跨 tab 切换时恢复视图状态。
 */
function FileViewer() {
  const { config } = useAppContext();
  const activeProjectId = useProjectStore((state) => state.activeProjectId);
  const activeProject = useProjectStore((state) => state.activeProject);
  const activeWorktreePath = useWorktreeStore((state) => state.activeWorktreePath);
  const { onFileSave: onSave, onFileContentChange: onContentChange } = useFileActionsContext();

  const theme = config.theme;
  const fontFamily = config.fontFamily;
  const fontSize = config.editorFontSize;

  // Composite tab key: unified across local/WSL/remote projects
  const currentProjectId = activeProjectId ?? activeProject?.id ?? null;
  const effectiveWorktreePath = activeWorktreePath ?? null;
  const tabKey = currentProjectId
    ? resolveTabKey(currentProjectId, effectiveWorktreePath)
    : currentProjectId;

  // Read project tabs from unified store
  const projectTabs = useEditorStore(
    useShallow((state) => {
      if (!tabKey) return null;
      return state.tabs[tabKey] ?? null;
    }),
  );

  // Read per-group activeTabId from EditorContext (correct in split mode)
  const { activeTabId: groupActiveTabId } = useEditorContext();

  // Collect all file tabs to render (keep editors alive across switches)
  const fileTabs = useMemo(() => {
    if (!projectTabs) return [];
    return projectTabs.tabs.filter(isFileTab) as (Tab & { data: FileTabData })[];
  }, [projectTabs]);

  if (fileTabs.length === 0) {
    return (
      <div className="flex flex-col h-full items-center justify-center text-text-secondary">
        <FileCode size={48} className="mb-3 opacity-30" />
        <p>No file open</p>
        <p className="text-xs mt-1 opacity-60">Select a file from the tree to start editing</p>
      </div>
    );
  }

  const projectPath = activeProject?.path ?? null;

  return (
    <div className="flex flex-col h-full">
      {fileTabs.map((tab) => {
        const fileTab = tabToFileTab(tab);
        const isActive = tab.id === groupActiveTabId;
        return (
          <div
            key={tab.id}
            className="flex-1 flex flex-col min-h-0"
            style={{ display: isActive ? 'flex' : 'none' }}
          >
            <FileEditor
              tab={fileTab}
              tabKey={tabKey ?? ''}
              tabId={tab.id}
              externallyModified={tab.data.externallyModified ?? false}
              theme={theme}
              fontFamily={fontFamily}
              fontSize={fontSize}
              projectPath={projectPath}
              onSave={onSave}
              onContentChange={onContentChange}
            />
          </div>
        );
      })}
    </div>
  );
}

export default React.memo(FileViewer);
