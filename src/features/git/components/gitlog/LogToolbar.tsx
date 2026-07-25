import React from 'react';
import { SearchIcon, RefreshCw } from '@/shared/components/icons';
import { cn } from '@/lib/utils';

interface LogToolbarProps {
  searchQuery: string;
  onSearchChange: (query: string) => void;
  onRefresh: () => void;
  loading: boolean;
}

const LogToolbar: React.FC<LogToolbarProps> = ({
  searchQuery,
  onSearchChange,
  onRefresh,
  loading,
}) => {
  return (
    <div className="flex items-center gap-1.5 px-2 py-1 bg-bg-tertiary/40 rounded-md shrink-0 border border-border/30 min-w-0 flex-1">
      <SearchIcon size={12} className="text-text-muted shrink-0" />
      <input
        type="text"
        className="flex-1 min-w-0 bg-transparent border-none outline-none text-[var(--font-size)] text-text-primary placeholder:text-text-muted"
        placeholder="Filter commits..."
        value={searchQuery}
        onChange={(e) => onSearchChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onSearchChange('');
        }}
        aria-label="Filter commits"
      />
      {searchQuery ? (
        <button
          type="button"
          className="text-text-muted hover:text-text-primary text-[calc(var(--font-size)-2px)] px-1 rounded hover:bg-bg-hover transition-colors"
          onClick={() => onSearchChange('')}
          title="Clear filter (Esc)"
        >
          ✕
        </button>
      ) : null}
      <button
        type="button"
        className={cn(
          'p-0.5 rounded text-text-muted hover:text-accent-blue hover:bg-bg-hover transition-colors duration-100',
          loading && 'animate-spin',
        )}
        title="Refresh"
        onClick={onRefresh}
        disabled={loading}
      >
        <RefreshCw size={12} />
      </button>
    </div>
  );
};

export default React.memo(LogToolbar);
