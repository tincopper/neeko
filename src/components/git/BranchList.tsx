import React, { useCallback, useState } from "react";
import { GitBranch, ChevronRight, ChevronDown, RefreshCw, Plus, ArrowRightLeft, GitBranchPlus, Trash2, Pencil } from "lucide-react";
import type { BranchGroup } from "../../types";
import ContextMenu, { type ContextMenuItem } from "../project/ContextMenu";

interface BranchListProps {
  branches: BranchGroup | null;
  loading: boolean;
  selectedBranch: string | null;
  onSelectBranch: (branch: string) => void;
  onRefresh: () => void;
  onNewBranch: () => void;
  onCheckout: (branch: string) => void;
  onDeleteBranch: (branch: string) => void;
  onRenameBranch: (oldName: string, newName: string) => void;
  onNewBranchFrom: (sourceBranch: string) => void;
  currentBranch: string;
}

interface BranchGroupSectionProps {
  title: string;
  branches: string[];
  icon: string;
  currentBranch: string;
  selectedBranch: string | null;
  isLocal: boolean;
  onSelectBranch: (branch: string) => void;
  onContextMenuAction: (branch: string, position: { x: number; y: number }) => void;
}

function BranchGroupSection({
  title,
  branches,
  icon,
  currentBranch,
  selectedBranch,
  isLocal,
  onSelectBranch,
  onContextMenuAction,
}: BranchGroupSectionProps) {
  const [expanded, setExpanded] = useState(true);

  if (branches.length === 0) return null;

  return (
    <div className="mb-1">
      <button
        className="flex items-center gap-1 w-full px-2 py-1 text-left text-[var(--font-size)] text-text-secondary hover:bg-bg-hover rounded-sm"
        onClick={() => setExpanded((v) => !v)}
      >
        {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <span className="font-medium">{icon} {title}</span>
        <span className="text-text-muted ml-1">({branches.length})</span>
      </button>
      {expanded && (
        <div className="ml-2">
          {branches.map((branch) => {
            const isCurrent = branch === currentBranch;
            const isSelected = branch === selectedBranch;
            return (
              <div
                key={branch}
                className={`flex items-center gap-1 px-2 py-[3px] rounded-sm cursor-pointer text-[var(--font-size)]
                  ${isSelected ? "bg-accent/20 text-accent" : "hover:bg-bg-hover text-text-primary"}
                  ${isCurrent ? "font-semibold" : ""}
                `}
                onClick={() => onSelectBranch(branch)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  if (isLocal) {
                    onContextMenuAction(branch, { x: e.clientX, y: e.clientY });
                  }
                }}
              >
                {isCurrent && <span className="text-accent text-xs">★</span>}
                <GitBranch size={12} className="shrink-0" />
                <span className="truncate">{branch.replace(/^origin\//, "")}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

const MemoizedBranchGroupSection = React.memo(BranchGroupSection);

function BranchList({
  branches,
  loading,
  selectedBranch,
  onSelectBranch,
  onRefresh,
  onNewBranch,
  onCheckout,
  onDeleteBranch,
  onRenameBranch,
  onNewBranchFrom,
  currentBranch,
}: BranchListProps) {
  const [contextMenu, setContextMenu] = useState<{ branch: string; position: { x: number; y: number } } | null>(null);

  const handleContextMenuAction = useCallback((branch: string, position: { x: number; y: number }) => {
    setContextMenu({ branch, position });
  }, []);

  const handleCloseContextMenu = useCallback(() => {
    setContextMenu(null);
  }, []);

  const contextMenuItems: ContextMenuItem[] = contextMenu ? [
    {
      label: "Checkout",
      icon: ArrowRightLeft,
      action: () => onCheckout(contextMenu.branch),
      disabled: contextMenu.branch === currentBranch,
    },
    {
      label: "New Branch From",
      icon: GitBranchPlus,
      action: () => onNewBranchFrom(contextMenu.branch),
    },
    { separator: true, label: "", action: () => {} },
    {
      label: "Rename",
      icon: Pencil,
      action: () => {
        const newName = window.prompt(`Rename branch "${contextMenu.branch}" to:`, contextMenu.branch);
        if (newName && newName !== contextMenu.branch) {
          onRenameBranch(contextMenu.branch, newName);
        }
      },
    },
    {
      label: "Delete",
      icon: Trash2,
      danger: true,
      action: () => onDeleteBranch(contextMenu.branch),
      disabled: contextMenu.branch === currentBranch,
    },
  ] : [];

  return (
    <div className="flex flex-col h-full border-r border-border">
      <div className="flex items-center justify-between px-2 py-2 border-b border-border">
        <span className="text-[var(--font-size)] font-semibold text-text-primary">Branches</span>
        <div className="flex items-center gap-1">
          <button
            className="p-1 rounded hover:bg-bg-hover text-text-secondary"
            onClick={onNewBranch}
            title="New Branch"
          >
            <Plus size={14} />
          </button>
          <button
            className="p-1 rounded hover:bg-bg-hover text-text-secondary"
            onClick={onRefresh}
            title="Refresh"
          >
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
          </button>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto py-1">
        {branches ? (
          <>
            <MemoizedBranchGroupSection
              title="Local"
              branches={branches.local}
              icon=""
              currentBranch={currentBranch}
              selectedBranch={selectedBranch}
              isLocal={true}
              onSelectBranch={onSelectBranch}
              onContextMenuAction={handleContextMenuAction}
            />
            <MemoizedBranchGroupSection
              title="Remote"
              branches={branches.remote}
              icon=""
              currentBranch={currentBranch}
              selectedBranch={selectedBranch}
              isLocal={false}
              onSelectBranch={onSelectBranch}
              onContextMenuAction={handleContextMenuAction}
            />
            <MemoizedBranchGroupSection
              title="Tags"
              branches={branches.tags}
              icon=""
              currentBranch={currentBranch}
              selectedBranch={selectedBranch}
              isLocal={false}
              onSelectBranch={onSelectBranch}
              onContextMenuAction={handleContextMenuAction}
            />
          </>
        ) : (
          <div className="px-2 py-4 text-center text-text-muted text-[var(--font-size)]">
            No branches loaded
          </div>
        )}
      </div>
      {contextMenu && (
        <ContextMenu
          items={contextMenuItems}
          position={contextMenu.position}
          onClose={handleCloseContextMenu}
        />
      )}
    </div>
  );
}

export default React.memo(BranchList);
