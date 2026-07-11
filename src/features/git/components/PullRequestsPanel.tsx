import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { closePr, isGhInstalled, isGhAuthenticated, listPrs, mergePr } from '../api/gitApi';
import type { PRListItem } from '@/shared/types';
import type { PRDetailTabData } from '@/features/editor/types';
import { useEditorStore } from '@/shared/store';
import { cn } from '@/lib/utils';
import { SearchIcon, MessageSquare, ChevronDown, GitMerge, X } from '@/shared/components/icons';

interface PullRequestsPanelProps {
  projectId: string;
  tabKey: string;
  onShowToast?: (message: string, type?: 'info' | 'error') => void;
  onRefreshGit: (projectId: string) => void;
  onOpenTerminal: (command: string, title: string) => void;
}

const STATE_OPTIONS = [
  { label: 'All', value: 'all' },
  { label: 'Open', value: 'open' },
  { label: 'Closed', value: 'closed' },
  { label: 'Merged', value: 'merged' },
];

function formatCreatedAt(timestamp: string | undefined | null): string {
  if (!timestamp) return '';
  try {
    const date = new Date(timestamp);
    if (isNaN(date.getTime())) return timestamp;
    return date.toLocaleDateString('zh-CN', {
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
    });
  } catch {
    return timestamp || '';
  }
}

function getStateBadgeClass(state: string): string {
  switch (state.toUpperCase()) {
    case 'OPEN':
      return 'bg-accent-green/15 text-accent-green';
    case 'CLOSED':
      return 'bg-accent-red/15 text-accent-red';
    case 'MERGED':
      return 'bg-[#a371f7]/20 text-[#a371f7]';
    default:
      return 'bg-bg-tertiary text-text-muted';
  }
}

const PullRequestsPanel: React.FC<PullRequestsPanelProps> = ({
  projectId,
  tabKey,
  onShowToast,
  onRefreshGit,
  onOpenTerminal,
}) => {
  const [prList, setPrList] = useState<PRListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [ghInstalled, setGhInstalled] = useState<boolean | null>(null);
  const [ghAuthenticated, setGhAuthenticated] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stateDropdownOpen, setStateDropdownOpen] = useState(false);
  const stateDropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    console.log('[PullRequestsPanel] Checking gh CLI...');
    isGhInstalled()
      .then((installed) => {
        console.log('[PullRequestsPanel] gh installed:', installed);
        setGhInstalled(installed);
      })
      .catch((err) => {
        console.error('[PullRequestsPanel] Failed to check gh installation:', err);
        setGhInstalled(false);
      });
    isGhAuthenticated()
      .then((auth) => {
        console.log('[PullRequestsPanel] gh authenticated:', auth);
        setGhAuthenticated(auth);
      })
      .catch((err) => {
        console.error('[PullRequestsPanel] Failed to check gh auth:', err);
        setGhAuthenticated(false);
      });
  }, []);

  const loadPRs = useCallback(async () => {
    console.log('[PullRequestsPanel] loadPRs called:', { projectId, filter, ghInstalled, ghAuthenticated });
    if (!ghInstalled || !ghAuthenticated) {
      console.log('[PullRequestsPanel] Skipping load - gh not ready');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const prs = await listPrs(projectId, filter === 'all' ? 'all' : filter, 50);
      console.log('[PullRequestsPanel] PRs loaded:', prs.length, 'items');
      if (prs.length > 0) {
        console.log('[PullRequestsPanel] First PR data:', JSON.stringify(prs[0], null, 2));
      }
      setPrList(prs);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load pull requests';
      setError(message);
      console.error('[PullRequestsPanel] Failed to load PRs:', err);
    } finally {
      setLoading(false);
    }
  }, [projectId, filter, ghInstalled, ghAuthenticated]);

  useEffect(() => {
    loadPRs();
  }, [loadPRs]);

  // Close dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (stateDropdownRef.current && !stateDropdownRef.current.contains(event.target as Node)) {
        setStateDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const filteredPrList = useMemo(() => {
    if (!searchQuery.trim()) return prList;
    const query = searchQuery.toLowerCase();
    return prList.filter(
      (pr) =>
        pr.title.toLowerCase().includes(query) ||
        pr.author.toLowerCase().includes(query) ||
        `#${pr.number}`.includes(query),
    );
  }, [prList, searchQuery]);

  const handleMerge = useCallback(
    async (number: number) => {
      setLoading(true);
      try {
        const result = await mergePr(projectId, number, 'squash');
        onShowToast?.(result.message, 'info');
        loadPRs();
        onRefreshGit(projectId);
      } catch (e: unknown) {
        onShowToast?.(String(e), 'error');
      } finally {
        setLoading(false);
      }
    },
    [projectId, loadPRs, onRefreshGit, onShowToast],
  );

  const handleClose = useCallback(
    async (number: number) => {
      setLoading(true);
      try {
        await closePr(projectId, number);
        onShowToast?.('PR closed', 'info');
        loadPRs();
      } catch (e: unknown) {
        onShowToast?.(String(e), 'error');
      } finally {
        setLoading(false);
      }
    },
    [projectId, loadPRs, onShowToast],
  );

  const handleOpenPr = useCallback(
    (pr: PRListItem) => {
      const editorState = useEditorStore.getState();
      const existingTabs = editorState.tabs[tabKey]?.tabs ?? [];
      const existingTab = existingTabs.find(
        (t) => t.data.kind === 'prDetail' && t.data.prNumber === pr.number,
      );
      if (existingTab) {
        editorState.activateTab(tabKey, existingTab.id);
        return;
      }

      const tabId = `tab_${crypto.randomUUID()}`;
      editorState.addTab(tabKey, {
        id: tabId,
        projectId,
        title: `#${pr.number} ${pr.title}`,
        order: 0,
        data: {
          kind: 'prDetail' as const,
          projectId,
          prNumber: pr.number,
          prTitle: pr.title,
          prState: pr.state,
          prBody: null,
          prAuthor: pr.author,
          prCreatedAt: pr.createdAt,
          prUrl: '',
          prHeadRef: pr.headRefName,
          prBaseRef: pr.baseRefName,
        } satisfies PRDetailTabData,
      });
    },
    [projectId, tabKey],
  );

  if (ghInstalled === null) {
    return null;
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border">
        <span className="text-[var(--font-size)] font-semibold text-text-primary">
          Pull Requests
        </span>
        {ghInstalled && ghAuthenticated && (
          <span className="text-[calc(var(--font-size)-2px)] text-text-muted bg-bg-tertiary px-2 py-0.5 rounded-full">
            {filteredPrList.length}
          </span>
        )}
      </div>

      {!ghInstalled ? (
        <div className="px-3 py-4 text-[var(--font-size)] text-text-muted space-y-2">
          <p>GitHub CLI (<code>gh</code>) is not installed.</p>
          <p>Install it to manage pull requests.</p>
          <button
            className="text-[calc(var(--font-size)-2px)] px-3 py-1.5 rounded bg-bg-tertiary text-text-primary hover:bg-bg-hover transition-colors duration-100"
            onClick={() => onOpenTerminal('brew install gh', 'Install gh')}
          >
            Install gh
          </button>
        </div>
      ) : !ghAuthenticated ? (
        <div className="px-3 py-4 text-[var(--font-size)] text-text-muted space-y-2">
          <p>Not authenticated with GitHub.</p>
          <p>Run <code>gh auth login</code> to authenticate.</p>
          <button
            className="text-[calc(var(--font-size)-2px)] px-3 py-1.5 rounded bg-bg-tertiary text-text-primary hover:bg-bg-hover transition-colors duration-100"
            onClick={() => onOpenTerminal('gh auth login', 'gh auth login')}
          >
            Login
          </button>
        </div>
      ) : (
        <>
          {/* Search Bar */}
          <div className="px-3 py-2 border-b border-border">
            <div className="relative flex items-center">
              <SearchIcon
                size={14}
                className="absolute left-2.5 text-text-muted pointer-events-none"
              />
              <input
                type="text"
                className="w-full pl-8 pr-3 py-1.5 bg-bg-primary border border-border rounded-md text-[var(--font-size)] text-text-primary placeholder-text-muted outline-none focus:border-accent-blue transition-colors duration-100"
                placeholder="Search pull requests..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
          </div>

          {/* Filter Bar */}
          <div className="px-3 py-2 border-b border-border flex items-center gap-2">
            {/* State Filter Dropdown */}
            <div className="relative" ref={stateDropdownRef}>
              <button
                className={cn(
                  'flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[calc(var(--font-size)-1px)] border transition-colors duration-100',
                  stateDropdownOpen
                    ? 'border-accent-blue bg-accent-blue/10 text-accent-blue'
                    : 'border-border bg-bg-primary text-text-secondary hover:border-accent-blue hover:text-text-primary',
                )}
                onClick={() => setStateDropdownOpen(!stateDropdownOpen)}
              >
                State
                <ChevronDown size={12} className={cn('transition-transform duration-150', stateDropdownOpen && 'rotate-180')} />
              </button>
              {stateDropdownOpen && (
                <div className="absolute top-full left-0 mt-1 w-32 bg-bg-secondary border border-border rounded-md shadow-lg z-50 py-1">
                  {STATE_OPTIONS.map((option) => (
                    <button
                      key={option.value}
                      className={cn(
                        'w-full text-left px-3 py-1.5 text-[calc(var(--font-size)-1px)] transition-colors duration-100',
                        filter === option.value
                          ? 'bg-accent-blue/10 text-accent-blue'
                          : 'text-text-secondary hover:bg-bg-hover hover:text-text-primary',
                      )}
                      onClick={() => {
                        setFilter(option.value);
                        setStateDropdownOpen(false);
                      }}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Other filter buttons (placeholder) */}
            <button className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[calc(var(--font-size)-1px)] border border-border bg-bg-primary text-text-secondary hover:border-accent-blue hover:text-text-primary transition-colors duration-100">
              Author
              <ChevronDown size={12} />
            </button>
            <button className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[calc(var(--font-size)-1px)] border border-border bg-bg-primary text-text-secondary hover:border-accent-blue hover:text-text-primary transition-colors duration-100">
              Label
              <ChevronDown size={12} />
            </button>
          </div>

          {/* PR List */}
          <div className="flex-1 overflow-y-auto">
            {loading && filteredPrList.length === 0 ? (
              <div className="p-4 text-center text-[var(--font-size)] text-text-muted">
                Loading...
              </div>
            ) : error ? (
              <div className="p-4 text-center text-[var(--font-size)]">
                <p className="text-accent-red mb-2">Failed to load pull requests</p>
                <p className="text-text-muted text-[calc(var(--font-size)-2px)]">{error}</p>
                <button
                  className="mt-2 px-3 py-1 text-[calc(var(--font-size)-2px)] bg-bg-tertiary rounded hover:bg-bg-hover transition-colors duration-100"
                  onClick={loadPRs}
                >
                  Retry
                </button>
              </div>
            ) : filteredPrList.length === 0 ? (
              <div className="p-4 text-center text-[var(--font-size)] text-text-muted">
                No pull requests
              </div>
            ) : (
              filteredPrList.map((pr) => (
                <div
                  key={pr.number}
                  className="flex items-center px-3 py-2.5 border-b border-border hover:bg-bg-hover transition-colors duration-100 cursor-pointer group"
                  onClick={() => handleOpenPr(pr)}
                >
                  {/* Left Content */}
                  <div className="flex-1 min-w-0">
                    <div className="text-[var(--font-size)] font-medium text-text-primary truncate mb-0.5">
                      {pr.title}
                    </div>
                    <div className="flex items-center gap-1.5 text-[calc(var(--font-size)-2px)] text-text-muted">
                      <span className="font-mono text-accent-blue">#{pr.number}</span>
                      <span>·</span>
                      <span>created {formatCreatedAt(pr.createdAt)}</span>
                      <span>·</span>
                      <span>
                        by <span className="text-text-secondary">{pr.author}</span>
                      </span>
                    </div>
                  </div>

                  {/* Right Content */}
                  <div className="flex items-center gap-2.5 ml-3 flex-shrink-0">
                    {/* Action buttons (hover) */}
                    {pr.state === 'OPEN' && (
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity duration-100">
                        <button
                          className="p-1 rounded hover:bg-bg-tertiary text-text-muted hover:text-accent-green"
                          title="Squash merge"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleMerge(pr.number);
                          }}
                        >
                          <GitMerge size={12} />
                        </button>
                        <button
                          className="p-1 rounded hover:bg-bg-tertiary text-text-muted hover:text-accent-red"
                          title="Close PR"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleClose(pr.number);
                          }}
                        >
                          <X size={12} />
                        </button>
                      </div>
                    )}

                    {/* Status Badge */}
                    <span
                      className={cn(
                        'px-2 py-0.5 rounded text-[calc(var(--font-size)-2px)] font-semibold uppercase tracking-wide',
                        getStateBadgeClass(pr.state),
                      )}
                    >
                      {pr.state}
                    </span>

                    {/* Comment Count */}
                    <div className="flex items-center gap-1 text-text-muted">
                      <MessageSquare size={13} />
                      <span className="text-[calc(var(--font-size)-2px)]">{pr.comment_count ?? 0}</span>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </>
      )}
    </div>
  );
};

export default React.memo(PullRequestsPanel);
