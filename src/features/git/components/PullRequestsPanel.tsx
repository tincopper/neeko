import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { closePr, isGhInstalled, isGhAuthenticated, listPrs, listRepoLabels, listRepoAuthors, mergePr } from '../api/gitApi';
import type { PRListItem } from '@/shared/types';
import type { PRDetailTabData } from '@/features/editor/types';
import { useEditorStore } from '@/shared/store';
import { cn } from '@/lib/utils';
import { getAvatarStyle } from '@/shared/utils/projectAvatar';
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
  const [authorFilter, setAuthorFilter] = useState<string | null>(null);
  const [labelFilter, setLabelFilter] = useState<string | null>(null);
  const [authorDropdownOpen, setAuthorDropdownOpen] = useState(false);
  const [labelDropdownOpen, setLabelDropdownOpen] = useState(false);
  const authorDropdownRef = useRef<HTMLDivElement>(null);
  const labelDropdownRef = useRef<HTMLDivElement>(null);
  const [repoLabels, setRepoLabels] = useState<import('../types').PrLabel[]>([]);
  const [repoAuthors, setRepoAuthors] = useState<string[]>([]);
  const [authorSearchQuery, setAuthorSearchQuery] = useState('');
  const [labelSearchQuery, setLabelSearchQuery] = useState('');
  const authorSearchRef = useRef<HTMLInputElement>(null);
  const labelSearchRef = useRef<HTMLInputElement>(null);
  const [assigneeFilter, setAssigneeFilter] = useState<string | null>(null);
  const [assigneeDropdownOpen, setAssigneeDropdownOpen] = useState(false);
  const [assigneeSearchQuery, setAssigneeSearchQuery] = useState('');
  const assigneeDropdownRef = useRef<HTMLDivElement>(null);
  const assigneeSearchRef = useRef<HTMLInputElement>(null);

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

  // Load full repo labels and authors list (separate from current PR list)
  useEffect(() => {
    if (!ghInstalled || !ghAuthenticated) return;
    listRepoLabels(projectId).then(setRepoLabels).catch(() => {});
    listRepoAuthors(projectId).then(setRepoAuthors).catch(() => {});
  }, [projectId, ghInstalled, ghAuthenticated]);

  // Use repo-level data for filter dropdowns, fall back to deriving from prList
  const filterAuthors = useMemo(() => {
    if (repoAuthors.length > 0) return repoAuthors;
    const authors = new Set(prList.map((pr) => pr.author).filter(Boolean));
    return Array.from(authors).sort();
  }, [repoAuthors, prList]);

  const filterLabels = useMemo(() => {
    if (repoLabels.length > 0) return repoLabels.map((l) => l.name).sort();
    const labels = new Set(prList.flatMap((pr) => pr.labels ?? []).map((l) => l.name));
    return Array.from(labels).sort();
  }, [repoLabels, prList]);

  const filterAssignees = useMemo(() => {
    const assignees = new Set(prList.flatMap((pr) => pr.assignees ?? []).map((a) => a.login).filter(Boolean));
    return Array.from(assignees).sort();
  }, [prList]);

  const filteredAuthorOptions = useMemo(() => {
    if (!authorSearchQuery.trim()) return filterAuthors;
    const q = authorSearchQuery.toLowerCase();
    return filterAuthors.filter((a) => a.toLowerCase().includes(q));
  }, [filterAuthors, authorSearchQuery]);

  const filteredLabelOptions = useMemo(() => {
    if (!labelSearchQuery.trim()) return filterLabels;
    const q = labelSearchQuery.toLowerCase();
    return filterLabels.filter((l) => l.toLowerCase().includes(q));
  }, [filterLabels, labelSearchQuery]);

  const filteredAssigneeOptions = useMemo(() => {
    if (!assigneeSearchQuery.trim()) return filterAssignees;
    const q = assigneeSearchQuery.toLowerCase();
    return filterAssignees.filter((a) => a.toLowerCase().includes(q));
  }, [filterAssignees, assigneeSearchQuery]);

  // Close dropdowns on outside click
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (stateDropdownRef.current && !stateDropdownRef.current.contains(event.target as Node)) {
        setStateDropdownOpen(false);
      }
      if (authorDropdownRef.current && !authorDropdownRef.current.contains(event.target as Node)) {
        setAuthorDropdownOpen(false);
      }
      if (labelDropdownRef.current && !labelDropdownRef.current.contains(event.target as Node)) {
        setLabelDropdownOpen(false);
      }
      if (assigneeDropdownRef.current && !assigneeDropdownRef.current.contains(event.target as Node)) {
        setAssigneeDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const filteredPrList = useMemo(() => {
    let list = prList;
    if (authorFilter) {
      list = list.filter((pr) => pr.author === authorFilter);
    }
    if (labelFilter) {
      list = list.filter((pr) => (pr.labels ?? []).some((l) => l.name === labelFilter));
    }
    if (assigneeFilter) {
      list = list.filter((pr) => (pr.assignees ?? []).some((a) => a.login === assigneeFilter));
    }
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      list = list.filter(
        (pr) =>
          pr.title.toLowerCase().includes(query) ||
          pr.author.toLowerCase().includes(query) ||
          `#${pr.number}`.includes(query),
      );
    }
    return list;
  }, [prList, searchQuery, authorFilter, labelFilter, assigneeFilter]);

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
    return (
      <div className="flex flex-col h-full">
        {/* Header */}
        <div className="flex items-center justify-between px-3 py-2 border-b border-border">
          <span className="text-[var(--font-size)] font-semibold text-text-primary">
            Pull Requests
          </span>
        </div>
        {/* Search skeleton */}
        <div className="px-3 py-2 border-b border-border">
          <div className="h-8 rounded-md bg-bg-hover animate-pulse" />
        </div>
        {/* Filter skeleton */}
        <div className="px-3 py-2 border-b border-border flex items-center gap-2">
          <div className="h-7 w-16 rounded-md bg-bg-hover animate-pulse" />
          <div className="h-7 w-20 rounded-md bg-bg-hover animate-pulse" />
          <div className="h-7 w-18 rounded-md bg-bg-hover animate-pulse" />
        </div>
        {/* List skeleton */}
        <div className="flex-1 p-4 space-y-3 animate-pulse">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 px-3 py-2.5">
              <div className="flex-1 min-w-0 space-y-2">
                <div className="h-3 w-3/4 rounded bg-bg-hover" />
                <div className="h-2 w-1/2 rounded bg-bg-hover" />
              </div>
              <div className="flex items-center gap-2">
                <div className="h-5 w-14 rounded-full bg-bg-hover" />
                <div className="h-3 w-8 rounded bg-bg-hover" />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
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
                {STATE_OPTIONS.find((o) => o.value === filter)?.label ?? 'State'}
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

            {/* Author Filter Dropdown */}
            <div className="relative" ref={authorDropdownRef}>
              <button
                className={cn(
                  'flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[calc(var(--font-size)-1px)] border transition-colors duration-100',
                  authorDropdownOpen || authorFilter
                    ? 'border-accent-blue bg-accent-blue/10 text-accent-blue'
                    : 'border-border bg-bg-primary text-text-secondary hover:border-accent-blue hover:text-text-primary',
                )}
                onClick={() => {
                  setAuthorDropdownOpen(!authorDropdownOpen);
                  if (!authorDropdownOpen) setAuthorSearchQuery('');
                }}
              >
                {authorFilter ?? 'Author'}
                {authorFilter && (
                  <X size={12} className="ml-0.5 hover:text-text-primary" onClick={(e) => { e.stopPropagation(); setAuthorFilter(null); }} />
                )}
                <ChevronDown size={12} className={cn('transition-transform duration-150', authorDropdownOpen && 'rotate-180')} />
              </button>
              {authorDropdownOpen && (
                <div className="absolute top-full left-0 mt-1 w-48 bg-bg-secondary border border-border rounded-md shadow-lg z-50 py-1 flex flex-col" style={{ maxHeight: '260px' }}>
                  <div className="px-2 pb-1 flex-shrink-0">
                    <input
                      ref={authorSearchRef}
                      type="text"
                      className="w-full px-2 py-1 bg-bg-primary border border-border rounded text-[calc(var(--font-size)-1px)] text-text-primary placeholder-text-muted outline-none focus:border-accent-blue"
                      placeholder="Search authors..."
                      value={authorSearchQuery}
                      onChange={(e) => setAuthorSearchQuery(e.target.value)}
                      autoFocus
                    />
                  </div>
                  <div className="overflow-y-auto flex-1">
                    {filteredAuthorOptions.length === 0 ? (
                      <div className="px-3 py-1.5 text-[calc(var(--font-size)-1px)] text-text-muted">No authors</div>
                    ) : (
                      filteredAuthorOptions.map((author) => (
                        <button
                          key={author}
                          className={cn(
                            'w-full text-left px-3 py-1.5 text-[calc(var(--font-size)-1px)] transition-colors duration-100',
                            authorFilter === author
                              ? 'bg-accent-blue/10 text-accent-blue'
                              : 'text-text-secondary hover:bg-bg-hover hover:text-text-primary',
                          )}
                          onClick={() => {
                            setAuthorFilter(authorFilter === author ? null : author);
                            setAuthorDropdownOpen(false);
                          }}
                        >
                          {author}
                        </button>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Label Filter Dropdown */}
            <div className="relative" ref={labelDropdownRef}>
              <button
                className={cn(
                  'flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[calc(var(--font-size)-1px)] border transition-colors duration-100',
                  labelDropdownOpen || labelFilter
                    ? 'border-accent-blue bg-accent-blue/10 text-accent-blue'
                    : 'border-border bg-bg-primary text-text-secondary hover:border-accent-blue hover:text-text-primary',
                )}
                onClick={() => {
                  setLabelDropdownOpen(!labelDropdownOpen);
                  if (!labelDropdownOpen) setLabelSearchQuery('');
                }}
              >
                {labelFilter ?? 'Label'}
                {labelFilter && (
                  <X size={12} className="ml-0.5 hover:text-text-primary" onClick={(e) => { e.stopPropagation(); setLabelFilter(null); }} />
                )}
                <ChevronDown size={12} className={cn('transition-transform duration-150', labelDropdownOpen && 'rotate-180')} />
              </button>
              {labelDropdownOpen && (
                <div className="absolute top-full left-0 mt-1 w-48 bg-bg-secondary border border-border rounded-md shadow-lg z-50 py-1 flex flex-col" style={{ maxHeight: '260px' }}>
                  <div className="px-2 pb-1 flex-shrink-0">
                    <input
                      ref={labelSearchRef}
                      type="text"
                      className="w-full px-2 py-1 bg-bg-primary border border-border rounded text-[calc(var(--font-size)-1px)] text-text-primary placeholder-text-muted outline-none focus:border-accent-blue"
                      placeholder="Search labels..."
                      value={labelSearchQuery}
                      onChange={(e) => setLabelSearchQuery(e.target.value)}
                      autoFocus
                    />
                  </div>
                  <div className="overflow-y-auto flex-1">
                    {filteredLabelOptions.length === 0 ? (
                      <div className="px-3 py-1.5 text-[calc(var(--font-size)-1px)] text-text-muted">No labels</div>
                    ) : (
                      filteredLabelOptions.map((label) => (
                        <button
                          key={label}
                          className={cn(
                            'w-full text-left px-3 py-1.5 text-[calc(var(--font-size)-1px)] transition-colors duration-100',
                            labelFilter === label
                              ? 'bg-accent-blue/10 text-accent-blue'
                              : 'text-text-secondary hover:bg-bg-hover hover:text-text-primary',
                          )}
                          onClick={() => {
                            setLabelFilter(labelFilter === label ? null : label);
                            setLabelDropdownOpen(false);
                          }}
                        >
                          {label}
                        </button>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Assignee Filter Dropdown */}
            <div className="relative" ref={assigneeDropdownRef}>
              <button
                className={cn(
                  'flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[calc(var(--font-size)-1px)] border transition-colors duration-100',
                  assigneeDropdownOpen || assigneeFilter
                    ? 'border-accent-blue bg-accent-blue/10 text-accent-blue'
                    : 'border-border bg-bg-primary text-text-secondary hover:border-accent-blue hover:text-text-primary',
                )}
                onClick={() => {
                  setAssigneeDropdownOpen(!assigneeDropdownOpen);
                  if (!assigneeDropdownOpen) setAssigneeSearchQuery('');
                }}
              >
                {assigneeFilter ?? 'Assignee'}
                {assigneeFilter && (
                  <X size={12} className="ml-0.5 hover:text-text-primary" onClick={(e) => { e.stopPropagation(); setAssigneeFilter(null); }} />
                )}
                <ChevronDown size={12} className={cn('transition-transform duration-150', assigneeDropdownOpen && 'rotate-180')} />
              </button>
              {assigneeDropdownOpen && (
                <div className="absolute top-full left-0 mt-1 w-48 bg-bg-secondary border border-border rounded-md shadow-lg z-50 py-1 flex flex-col" style={{ maxHeight: '260px' }}>
                  <div className="px-2 pb-1 flex-shrink-0">
                    <input
                      ref={assigneeSearchRef}
                      type="text"
                      className="w-full px-2 py-1 bg-bg-primary border border-border rounded text-[calc(var(--font-size)-1px)] text-text-primary placeholder-text-muted outline-none focus:border-accent-blue"
                      placeholder="Search assignees..."
                      value={assigneeSearchQuery}
                      onChange={(e) => setAssigneeSearchQuery(e.target.value)}
                      autoFocus
                    />
                  </div>
                  <div className="overflow-y-auto flex-1">
                    {filteredAssigneeOptions.length === 0 ? (
                      <div className="px-3 py-1.5 text-[calc(var(--font-size)-1px)] text-text-muted">No assignees</div>
                    ) : (
                      filteredAssigneeOptions.map((assignee) => (
                        <button
                          key={assignee}
                          className={cn(
                            'w-full text-left px-3 py-1.5 text-[calc(var(--font-size)-1px)] transition-colors duration-100',
                            assigneeFilter === assignee
                              ? 'bg-accent-blue/10 text-accent-blue'
                              : 'text-text-secondary hover:bg-bg-hover hover:text-text-primary',
                          )}
                          onClick={() => {
                            setAssigneeFilter(assigneeFilter === assignee ? null : assignee);
                            setAssigneeDropdownOpen(false);
                          }}
                        >
                          {assignee}
                        </button>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* PR List */}
          <div className="flex-1 overflow-y-auto">
            {loading && filteredPrList.length === 0 ? (
              <div className="p-4 space-y-3 animate-pulse">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="flex items-center gap-3 px-3 py-2.5">
                    <div className="flex-1 min-w-0 space-y-2">
                      <div className="h-3 w-3/4 rounded bg-bg-hover" />
                      <div className="h-2 w-1/2 rounded bg-bg-hover" />
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="h-5 w-14 rounded-full bg-bg-hover" />
                      <div className="h-3 w-8 rounded bg-bg-hover" />
                    </div>
                  </div>
                ))}
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
                  className="flex items-center gap-3 px-3 py-2.5 border-b border-border hover:bg-bg-hover transition-colors duration-100 cursor-pointer group"
                  onClick={() => handleOpenPr(pr)}
                >
                  {/* Author Avatar */}
                  <div className="flex-shrink-0">
                    <div
                      className="w-7 h-7 rounded-full flex items-center justify-center text-[12px] font-semibold"
                      style={getAvatarStyle({ name: pr.author })}
                    >
                      {(pr.author?.charAt(0) || '#').toUpperCase()}
                    </div>
                  </div>
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
                      {pr.assignees && pr.assignees.length > 0 && (
                        <>
                          <span>·</span>
                          <span>
                            assigned to <span className="text-text-secondary">{pr.assignees.map(a => a.login).join(', ')}</span>
                          </span>
                        </>
                      )}
                    </div>
                    {pr.labels && pr.labels.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1">
                        {pr.labels.map((label) => (
                          <span
                            key={label.name}
                            className="inline-block px-1.5 py-0.5 rounded text-[10px] font-medium leading-tight"
                            style={{
                              backgroundColor: label.color ? `#${label.color}20` : 'var(--bg-tertiary)',
                              color: label.color ? `#${label.color}` : 'var(--text-muted)',
                              border: label.color ? `1px solid #${label.color}40` : '1px solid transparent',
                            }}
                          >
                            {label.name}
                          </span>
                        ))}
                      </div>
                    )}
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
                      <span className="text-[calc(var(--font-size)-2px)]">{pr.commentCount ?? 0}</span>
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
