import { Search, X } from 'lucide-react';
import React from 'react';

import { cn } from '@/lib/utils';

interface LibrarySearchBarProps {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}

/** Library search bar — controlled input + clear button. */
const LibrarySearchBar: React.FC<LibrarySearchBarProps> = React.memo(
  ({ value, onChange, placeholder }) => {
    return (
      <div className="shrink-0 px-4 py-2 border-b border-border">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-text-muted" />
          <input
            className={cn(
              'w-full h-8 pl-8 pr-8 text-[var(--font-size)] rounded-lg',
              'bg-bg-hover/50 border border-border/80 text-text-primary',
              'outline-none focus:border-border focus:bg-bg-primary placeholder:text-text-muted',
            )}
            placeholder={placeholder}
            value={value}
            onChange={(e) => onChange(e.target.value)}
          />
          {value && (
            <button
              type="button"
              className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 rounded text-text-muted hover:text-text-primary"
              onClick={() => onChange('')}
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </div>
      </div>
    );
  },
);

LibrarySearchBar.displayName = 'LibrarySearchBar';

export default LibrarySearchBar;
