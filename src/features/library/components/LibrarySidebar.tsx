import { ChevronDown, ChevronRight, FolderOpen, Globe } from 'lucide-react';
import React, { useEffect, useMemo, useState } from 'react';

import { useLibraryStore } from '@/features/library/store/libraryStore';
import { cn } from '@/lib/utils';

import { getAllPromptTags } from '../api/libraryApi';

const LibrarySidebar: React.FC = React.memo(() => {
  const tagFilter = useLibraryStore((s) => s.tagFilter);
  const setTagFilter = useLibraryStore((s) => s.setTagFilter);
  const scopeFilter = useLibraryStore((s) => s.scopeFilter);
  const setScopeFilter = useLibraryStore((s) => s.setScopeFilter);

  const [tags, setTags] = useState<string[]>([]);
  const [tagsExpanded, setTagsExpanded] = useState(true);
  const [scopeExpanded, setScopeExpanded] = useState(true);

  useEffect(() => {
    void getAllPromptTags()
      .then(setTags)
      .catch(() => setTags([]));
  }, []);

  const scopeOptions = useMemo(
    () => [
      { value: 'all' as const, label: 'All', icon: null },
      { value: 'global' as const, label: 'Global', icon: Globe },
      { value: 'project' as const, label: 'Project', icon: FolderOpen },
    ],
    [],
  );

  return (
    <div className="flex-1 overflow-y-auto thin-scrollbar py-2 px-1.5">
      {/* Scope filter */}
      <div className="mb-1">
        <button
          type="button"
          className="flex items-center gap-1 px-2 py-1.5 w-full min-w-0 text-left select-none"
          onClick={() => setScopeExpanded((v) => !v)}
        >
          {scopeExpanded ? (
            <ChevronDown className="h-3 w-3 text-text-muted shrink-0" />
          ) : (
            <ChevronRight className="h-3 w-3 text-text-muted shrink-0" />
          )}
          <span className="text-[10.5px] font-bold tracking-[0.14em] uppercase text-text-muted">
            Scope
          </span>
        </button>
        {scopeExpanded && (
          <div className="flex flex-col gap-0.5">
            {scopeOptions.map((opt) => {
              const Icon = opt.icon;
              const active = scopeFilter === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  className={cn(
                    'flex items-center gap-2 px-2.5 py-1.5 rounded-md text-left transition-colors',
                    'text-[var(--font-size)]',
                    active
                      ? 'bg-bg-selected text-text-primary'
                      : 'text-text-secondary hover:bg-bg-hover hover:text-text-primary',
                  )}
                  onClick={() => setScopeFilter(opt.value)}
                >
                  {Icon ? (
                    <Icon className="h-3.5 w-3.5 shrink-0 opacity-60" />
                  ) : (
                    <span className="w-3.5 shrink-0" />
                  )}
                  <span className="truncate font-medium">{opt.label}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Tag filter */}
      <div className="border-t border-border mt-1 pt-1">
        <button
          type="button"
          className="flex items-center gap-1 px-2 py-1.5 w-full min-w-0 text-left select-none"
          onClick={() => setTagsExpanded((v) => !v)}
        >
          {tagsExpanded ? (
            <ChevronDown className="h-3 w-3 text-text-muted shrink-0" />
          ) : (
            <ChevronRight className="h-3 w-3 text-text-muted shrink-0" />
          )}
          <span className="text-[10.5px] font-bold tracking-[0.14em] uppercase text-text-muted">
            Tags
          </span>
        </button>
        {tagsExpanded && (
          <div className="flex flex-wrap gap-1 px-1.5 py-1">
            {tags.length === 0 ? (
              <span className="text-[10.5px] text-text-muted">No tags yet</span>
            ) : (
              tags.map((tag) => {
                const active = tagFilter.includes(tag);
                return (
                  <button
                    key={tag}
                    type="button"
                    className={cn(
                      'h-6 px-2 text-[11px] rounded-md border transition-colors',
                      active
                        ? 'bg-accent-blue/15 text-accent-blue border-accent-blue/30'
                        : 'bg-bg-primary text-text-secondary border-border hover:bg-bg-hover',
                    )}
                    onClick={() => setTagFilter(active ? [] : [tag])}
                  >
                    {tag}
                  </button>
                );
              })
            )}
          </div>
        )}
      </div>
    </div>
  );
});

LibrarySidebar.displayName = 'LibrarySidebar';

export default LibrarySidebar;
