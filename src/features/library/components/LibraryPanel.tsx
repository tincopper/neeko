import React, { useCallback, useEffect } from 'react';
import { usePanelRef, type Layout, type LayoutChangedMeta } from 'react-resizable-panels';

import { useLibraryStore } from '@/features/library/store/libraryStore';
import { ISLAND_SPLIT_GROUP_CLASS } from '@/layout/islands';
import type { PromptInsertTarget, PromptResource } from '@/shared/types/library';
import { ISLAND_CLASS } from '@/ui/Island';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/ui/Resizable';

import { usePromptInsert } from '../hooks/usePromptInsert';

import LibraryActivityBar from './LibraryActivityBar';
import LibraryDetail from './LibraryDetail';
import LibraryNavTree from './LibraryNavTree';
import PromptEditorDialog from './PromptEditorDialog';
import PromptInsertDialog from './PromptInsertDialog';
import VariableDialog from './VariableDialog';

/** Nav column constraints: content-driven px floor, proportional ceiling. */
const NAV_MIN_PX = 200;
const NAV_MAX_PERCENT = 40;
/** Detail column never squeezes below list readability. */
const DETAIL_MIN_PX = 320;

interface LibraryPanelProps {
  onInsertPrompt?: (prompt: PromptResource, target?: PromptInsertTarget) => void;
}

const LibraryPanel: React.FC<LibraryPanelProps> = React.memo(({ onInsertPrompt }) => {
  const refreshPrompts = useLibraryStore((s) => s.refreshPrompts);
  const variableDialogOpen = useLibraryStore((s) => s.variableDialogOpen);
  const variableDialogContent = useLibraryStore((s) => s.variableDialogContent);
  const variableDialogResolve = useLibraryStore((s) => s.variableDialogResolve);
  const closeVariableDialog = useLibraryStore((s) => s.closeVariableDialog);
  const navSize = useLibraryStore((s) => s.navSize);
  const setNavSize = useLibraryStore((s) => s.setNavSize);
  const navPanelRef = usePanelRef();

  useEffect(() => {
    void refreshPrompts();
  }, [refreshPrompts]);

  // ── Split persistence（与 DockLayout 同一标准：Group 级 onLayoutChanged pointer-up
  // 语义 + isUserInteraction 过滤程序性变化，store 写入不与拖动并发）──
  const handleLayoutChanged = useCallback(
    (_layout: Layout, meta: LayoutChangedMeta) => {
      if (!meta.isUserInteraction) return;
      const size = navPanelRef.current?.getSize();
      if (size && size.asPercentage > 0) {
        setNavSize(size.asPercentage);
      }
    },
    [navPanelRef, setNavSize],
  );

  const handleInsert = usePromptInsert(onInsertPrompt);

  const handleVariableConfirm = useCallback(
    (rendered: string) => {
      variableDialogResolve?.(rendered);
      closeVariableDialog();
    },
    [variableDialogResolve, closeVariableDialog],
  );

  return (
    <div className="flex flex-col h-full min-h-0 overflow-hidden bg-bg-primary">
      <ResizablePanelGroup
        orientation="horizontal"
        id="library-split"
        className={`flex-1 min-h-0 ${ISLAND_SPLIT_GROUP_CLASS}`}
        onLayoutChanged={handleLayoutChanged}
      >
        <ResizablePanel
          id="library-nav"
          defaultSize={`${navSize}%`}
          minSize={NAV_MIN_PX}
          maxSize={`${NAV_MAX_PERCENT}%`}
          panelRef={navPanelRef}
          className={ISLAND_CLASS}
        >
          <LibraryActivityBar />
          <LibraryNavTree />
        </ResizablePanel>
        <ResizableHandle id="library-nav-handle" />
        <ResizablePanel
          id="library-detail"
          minSize={DETAIL_MIN_PX}
          className={`min-w-0 ${ISLAND_CLASS}`}
        >
          <LibraryDetail onInsertPrompt={onInsertPrompt} />
        </ResizablePanel>
      </ResizablePanelGroup>
      <PromptEditorDialog />
      <PromptInsertDialog onInsert={handleInsert} />
      {variableDialogOpen && variableDialogContent && (
        <VariableDialog
          content={variableDialogContent}
          onConfirm={handleVariableConfirm}
          onCancel={closeVariableDialog}
        />
      )}
    </div>
  );
});

LibraryPanel.displayName = 'LibraryPanel';

export default LibraryPanel;
