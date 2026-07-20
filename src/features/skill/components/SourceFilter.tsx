import React, { useMemo, useState } from 'react';
import { X, Search } from '@/shared/components/icons';
import { cn } from '@/lib/utils';

interface SourceFilterProps {
  sources: string[];
  value: string | null;
  onChange: (value: string | null) => void;
  disabled?: boolean;
}

const SourceFilter: React.FC<SourceFilterProps> = React.memo(
  ({ sources, value, onChange, disabled }) => {
    const [query, setQuery] = useState('');

    const filteredSources = useMemo(() => {
      if (!query.trim()) return sources;
      const q = query.toLowerCase();
      return sources.filter(s => s.toLowerCase().includes(q));
    }, [sources, query]);

    if (sources.length === 0) return null;

    return (
      <div className="flex items-center gap-1.5 px-2 py-1.5 border-b border-border overflow-x-auto shrink-0">
        <span className="text-[10.5px] font-bold tracking-[0.12em] uppercase text-text-muted shrink-0">
          Source
        </span>
        <div className="relative shrink-0">
          <Search className="absolute left-1.5 top-1/2 -translate-y-1/2 h-2.5 w-2.5 text-text-muted" />
          <input
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Filter…"
            disabled={disabled}
            className="h-6 w-20 pl-5 pr-1.5 text-[11px] rounded-md bg-bg-hover/60 border border-transparent text-text-primary placeholder:text-text-muted outline-none focus:border-border"
          />
        </div>
        <button
          type="button"
          onClick={() => onChange(null)}
          disabled={disabled}
          className={cn(
            'shrink-0 h-6 px-2 text-[11px] rounded-md transition-colors',
            value === null
              ? 'bg-accent/12 text-accent'
              : 'text-text-secondary hover:bg-bg-hover',
            disabled && 'opacity-50 cursor-not-allowed',
          )}
        >
          All
        </button>
        {filteredSources.map(source => (
          <button
            key={source}
            type="button"
            onClick={() => onChange(source === value ? null : source)}
            disabled={disabled}
            className={cn(
              'shrink-0 inline-flex items-center gap-1 h-6 px-2 text-[11px] rounded-md transition-colors',
              value === source
                ? 'bg-accent/12 text-accent'
                : 'text-text-secondary hover:bg-bg-hover',
              disabled && 'opacity-50 cursor-not-allowed',
            )}
          >
            <img
              src={`https://github.com/${source.split('/')[0]}.png?size=16`}
              alt=""
              className="w-3 h-3 rounded-sm"
              loading="lazy"
            />
            <span className="max-w-[100px] truncate">{source}</span>
            {value === source && <X className="h-2.5 w-2.5" />}
          </button>
        ))}
      </div>
    );
  },
);

SourceFilter.displayName = 'SourceFilter';

export default SourceFilter;
