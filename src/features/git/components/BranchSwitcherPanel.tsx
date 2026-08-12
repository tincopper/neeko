import { SearchIcon, Plus, FolderGit2, ArrowUp, ArrowDown } from 'lucide-react';
import React, { useRef, useEffect, useMemo, useState, useCallback } from 'react';

export interface BranchSwitcherPanelProps {
  branches: string[];
  currentBranch: string;
  favoriteBranches: string[];
  aheadBehind: Record<string, { ahead: number; behind: number }>;
  onCheckout: (branchName: string) => void;
  onToggleFavorite: (branchName: string) => void;
  onNewBranch: () => void;
  onNewWorktree: () => void;
  onClose: () => void;
}

type SectionType = 'local' | 'remote';

interface BranchItem {
  name: string;
  isRemote: boolean;
  isFavorite: boolean;
  isCurrent: boolean;
  section: SectionType;
}

function getSection(branchName: string): SectionType {
  if (branchName.includes('/')) return 'remote';
  return 'local';
}

function BranchSwitcherPanel({
  branches,
  currentBranch,
  favoriteBranches,
  aheadBehind,
  onCheckout,
  onToggleFavorite,
  onNewBranch,
  onNewWorktree,
  onClose,
}: BranchSwitcherPanelProps) {
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [focusIndex, setFocusIndex] = useState(-1);
  const [contextMenu, setContextMenu] = useState<{
    branch: string;
    x: number;
    y: number;
  } | null>(null);

  useEffect(() => {
    searchRef.current?.focus();
  }, []);

  const allItems = useMemo<BranchItem[]>(() => {
    const items: BranchItem[] = [];
    for (const name of branches) {
      const section = getSection(name);
      items.push({
        name,
        isRemote: name.includes('/'),
        isFavorite: favoriteBranches.includes(name),
        isCurrent: name === currentBranch,
        section,
      });
    }
    return items;
  }, [branches, favoriteBranches, currentBranch]);

  const filteredItems = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    if (!q) return allItems;
    return allItems.filter((item) => item.name.toLowerCase().includes(q));
  }, [allItems, searchQuery]);

  const local = useMemo(() => filteredItems.filter((i) => i.section === 'local'), [filteredItems]);
  const remote = useMemo(
    () => filteredItems.filter((i) => i.section === 'remote'),
    [filteredItems],
  );

  const sections = useMemo(() => {
    const s: { type: SectionType; label: string; items: BranchItem[] }[] = [];
    if (local.length > 0) s.push({ type: 'local', label: 'Local', items: local });
    if (remote.length > 0)
      s.push({
        type: 'remote',
        label: 'Remote (origin)',
        items: remote,
      });
    return s;
  }, [local, remote]);

  const totalItems = sections.reduce((sum, s) => sum + s.items.length, 0);

  useEffect(() => {
    const id = setTimeout(() => setFocusIndex(-1), 0);
    return () => clearTimeout(id);
  }, [searchQuery]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (contextMenu) {
        if (e.key === 'Escape') {
          e.preventDefault();
          setContextMenu(null);
        }
        return;
      }

      switch (e.key) {
        case 'Escape':
          e.preventDefault();
          onClose();
          break;
        case 'ArrowDown':
          e.preventDefault();
          setFocusIndex((prev) => (prev < totalItems - 1 ? prev + 1 : 0));
          break;
        case 'ArrowUp':
          e.preventDefault();
          setFocusIndex((prev) => (prev > 0 ? prev - 1 : totalItems - 1));
          break;
        case 'Enter': {
          e.preventDefault();
          if (searchQuery && filteredItems.length === 1 && !filteredItems[0].isCurrent) {
            onCheckout(filteredItems[0].name);
            onClose();
          } else if (focusIndex >= 0 && focusIndex < totalItems) {
            let idx = 0;
            for (const section of sections) {
              for (const item of section.items) {
                if (idx === focusIndex) {
                  if (!item.isCurrent) {
                    onCheckout(item.name);
                    onClose();
                  }
                  return;
                }
                idx++;
              }
            }
          }
          break;
        }
        case ' ': {
          e.preventDefault();
          if (focusIndex >= 0 && focusIndex < totalItems) {
            let idx = 0;
            for (const section of sections) {
              for (const item of section.items) {
                if (idx === focusIndex) {
                  onToggleFavorite(item.name);
                  return;
                }
                idx++;
              }
            }
          }
          break;
        }
      }
    },
    [
      contextMenu,
      totalItems,
      searchQuery,
      filteredItems,
      focusIndex,
      sections,
      onCheckout,
      onClose,
      onToggleFavorite,
    ],
  );

  useEffect(() => {
    if (focusIndex >= 0 && listRef.current) {
      const items = listRef.current.querySelectorAll<HTMLElement>('[data-branch-index]');
      items[focusIndex]?.scrollIntoView({ block: 'nearest' });
    }
  }, [focusIndex]);

  const handleContextMenu = useCallback((e: React.MouseEvent, branchName: string) => {
    e.preventDefault();
    setContextMenu({ branch: branchName, x: e.clientX, y: e.clientY });
  }, []);

  const handleContextAction = useCallback(
    (action: string) => {
      if (!contextMenu) return;
      const { branch } = contextMenu;
      setContextMenu(null);
      switch (action) {
        case 'checkout':
          if (branch !== currentBranch) {
            onCheckout(branch);
            onClose();
          }
          break;
        case 'delete':
          break;
        case 'copy-name':
          // 静默豁免：剪贴板写入失败浏览器已静默兜底，无需上报
          navigator.clipboard.writeText(branch).catch(() => {});
          break;
        default:
          break;
      }
    },
    [contextMenu, currentBranch, onCheckout, onClose],
  );

  const hasItems = totalItems > 0;

  let globalIdx = 0;

  return (
    <div
      className="bg-bg-secondary border border-border rounded-lg min-w-[260px] max-w-[360px] shadow-xl overflow-hidden flex flex-col"
      onKeyDown={handleKeyDown}
      role="listbox"
      tabIndex={0}
      aria-label="Branch switcher"
    >
      {/* Search */}
      <div className="flex items-center gap-1.5 px-2.5 py-2 border-b border-border">
        <SearchIcon size={12} className="text-text-muted shrink-0" />
        <input
          ref={searchRef}
          className="flex-1 bg-transparent border-none outline-none text-text-primary text-[var(--font-size)] placeholder:text-text-muted"
          placeholder="Search branches..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
      </div>

      {/* Branch list */}
      <div ref={listRef} className="max-h-[320px] overflow-y-auto py-1" role="presentation">
        {!hasItems && (
          <div className="px-3 py-8 text-center text-[var(--font-size)] text-text-muted">
            No branches found
          </div>
        )}

        {sections.map((section) => (
          <div key={section.type}>
            {/* Section header */}
            <div className="flex items-center px-3 mt-0.5">
              <span className="text-[10px] text-text-muted/60 tracking-wider">{section.label}</span>
            </div>

            {/* Section items */}
            {section.items.map((item) => {
              const idx = globalIdx++;
              const ab = aheadBehind[item.name] ?? null;
              const isFocused = focusIndex === idx;

              return (
                <div
                  key={item.name}
                  data-branch-index={idx}
                  role="option"
                  aria-selected={item.isCurrent}
                  tabIndex={-1}
                  className={`flex items-center gap-1.5 py-1 pr-3 text-[var(--font-size)] cursor-pointer transition-colors duration-75 ${
                    item.isCurrent
                      ? 'border-l-[3px] border-accent-blue pl-[5px] text-accent-blue'
                      : 'border-l-[3px] border-transparent pl-[5px] text-text-secondary hover:text-text-primary'
                  } ${isFocused ? 'bg-accent-blue/10' : 'hover:bg-bg-hover'}`}
                  onClick={() => {
                    if (!item.isCurrent) {
                      onCheckout(item.name);
                      onClose();
                    }
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      if (!item.isCurrent) {
                        onCheckout(item.name);
                        onClose();
                      }
                    }
                  }}
                  onContextMenu={(e) => handleContextMenu(e, item.name)}
                >
                  {/* Star */}
                  <span
                    role="button"
                    tabIndex={-1}
                    className={`shrink-0 w-3.5 text-center text-[11px] cursor-pointer transition-colors duration-100 ${
                      item.isFavorite
                        ? 'text-accent-yellow'
                        : 'text-text-muted/20 hover:!text-text-muted'
                    } hover:opacity-100 hover:text-accent-yellow`}
                    onClick={(e) => {
                      e.stopPropagation();
                      onToggleFavorite(item.name);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        e.stopPropagation();
                        onToggleFavorite(item.name);
                      }
                    }}
                    title={item.isFavorite ? 'Remove from favorites' : 'Add to favorites'}
                  >
                    {item.isFavorite ? '\u2605' : '\u2606'}
                  </span>

                  {/* Name */}
                  <span className="flex-1 truncate font-medium">{item.name}</span>

                  {/* Ahead/Behind — only on focused or active branch */}
                  {(isFocused || item.isCurrent) && ab && (ab.ahead > 0 || ab.behind > 0) && (
                    <span className="flex items-center gap-1 shrink-0 text-[11px] text-text-muted font-sans">
                      {ab.ahead > 0 && (
                        <span
                          className="flex items-center gap-0.5 text-accent-green"
                          title={`${ab.ahead} ahead`}
                        >
                          <ArrowUp size={9} />
                          {ab.ahead}
                        </span>
                      )}
                      {ab.behind > 0 && (
                        <span
                          className="flex items-center gap-0.5 text-accent-blue"
                          title={`${ab.behind} behind`}
                        >
                          <ArrowDown size={9} />
                          {ab.behind}
                        </span>
                      )}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>

      {/* Bottom action bar */}
      <div className="flex border-t border-border">
        <button
          className="flex-1 flex items-center justify-center gap-1.5 py-2 text-[12px] text-text-secondary hover:text-text-primary hover:bg-bg-hover transition-colors duration-100"
          onClick={() => {
            onNewBranch();
            onClose();
          }}
        >
          <Plus size={12} />
          New Branch
        </button>
        <button
          className="flex-1 flex items-center justify-center gap-1.5 py-2 text-[12px] text-text-secondary hover:text-text-primary hover:bg-bg-hover transition-colors duration-100 border-l border-border"
          onClick={() => {
            onNewWorktree();
            onClose();
          }}
        >
          <FolderGit2 size={12} />
          New Worktree
        </button>
      </div>

      {/* Context Menu */}
      {contextMenu && (
        <>
          <button
            className="fixed inset-0 z-[999] w-full h-full cursor-default"
            onClick={() => setContextMenu(null)}
            aria-label="Close context menu"
            type="button"
          />
          <div
            className="fixed z-[1000] bg-bg-secondary border border-border rounded-lg shadow-xl py-1 min-w-[160px]"
            style={{ left: contextMenu.x, top: contextMenu.y }}
          >
            <button
              className="w-full text-left px-3 py-1.5 text-[12px] text-text-secondary hover:bg-bg-hover hover:text-text-primary transition-colors"
              onClick={() => handleContextAction('checkout')}
            >
              Checkout
            </button>
            <div className="mx-2 h-px bg-border" />
            <button
              className="w-full text-left px-3 py-1.5 text-[12px] text-text-muted opacity-50 cursor-not-allowed"
              disabled
              title="Coming soon"
            >
              Compare with Current
            </button>
            <button
              className="w-full text-left px-3 py-1.5 text-[12px] text-text-muted opacity-50 cursor-not-allowed"
              disabled
              title="Coming soon"
            >
              Merge into Current
            </button>
            <button
              className="w-full text-left px-3 py-1.5 text-[12px] text-text-muted opacity-50 cursor-not-allowed"
              disabled
              title="Coming soon"
            >
              Rebase onto Current
            </button>
            <div className="mx-2 h-px bg-border" />
            <button
              className="w-full text-left px-3 py-1.5 text-[12px] text-text-secondary hover:bg-bg-hover hover:text-text-primary transition-colors"
              onClick={() => handleContextAction('delete')}
            >
              Delete
            </button>
            <div className="mx-2 h-px bg-border" />
            <button
              className="w-full text-left px-3 py-1.5 text-[12px] text-text-secondary hover:bg-bg-hover hover:text-text-primary transition-colors"
              onClick={() => handleContextAction('copy-name')}
            >
              Copy Name
            </button>
          </div>
        </>
      )}
    </div>
  );
}

export default React.memo(BranchSwitcherPanel);
