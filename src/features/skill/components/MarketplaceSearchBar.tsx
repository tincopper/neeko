import React from 'react';
import { Search, X } from '@/shared/components/icons';

interface MarketplaceSearchBarProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}

const MarketplaceSearchBar: React.FC<MarketplaceSearchBarProps> = React.memo(
  ({ value, onChange, placeholder = 'Search marketplace…' }) => {
    return (
      <div className="px-2 py-1.5 border-b border-border shrink-0">
        <div className="relative flex items-center">
          <Search className="absolute left-2 h-3 w-3 text-text-muted pointer-events-none" />
          <input
            type="search"
            value={value}
            onChange={e => onChange(e.target.value)}
            placeholder={placeholder}
            className="w-full h-7 pl-7 pr-7 text-[var(--font-size)] rounded-md bg-bg-hover/60 border border-transparent text-text-primary placeholder:text-text-muted outline-none focus:border-border focus:bg-bg-primary transition-colors"
          />
          {value ? (
            <button
              type="button"
              onClick={() => onChange('')}
              className="absolute right-1.5 p-0.5 text-text-muted hover:text-text-primary rounded"
              aria-label="Clear search"
            >
              <X className="h-3 w-3" />
            </button>
          ) : null}
        </div>
      </div>
    );
  },
);

MarketplaceSearchBar.displayName = 'MarketplaceSearchBar';

export default MarketplaceSearchBar;
