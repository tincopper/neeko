import React from 'react';
import { Search, X } from 'lucide-react';
import { cn } from '@/lib/utils';

interface SkillSearchInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  clearable?: boolean;
  className?: string;
}

/**
 * Compact filter field — matches IDE sidebar search (Quick Open density).
 */
const SkillSearchInput: React.FC<SkillSearchInputProps> = ({
  value,
  onChange,
  placeholder = 'Search...',
  clearable = false,
  className,
}) => {
  return (
    <div className={cn('px-2 py-1.5 border-b border-border shrink-0', className)}>
      <div className="relative flex items-center">
        <Search className="absolute left-2 h-3 w-3 text-text-muted pointer-events-none shrink-0" />
        <input
          type="text"
          role="textbox"
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          className={cn(
            'w-full h-7 pl-7 text-[var(--font-size)] rounded-md',
            'bg-bg-hover/60 border border-transparent',
            'text-text-primary placeholder:text-text-muted',
            'outline-none focus:border-border focus:bg-bg-primary transition-colors',
            clearable && value ? 'pr-7' : 'pr-2',
          )}
        />
        {clearable && value ? (
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
};

export default React.memo(SkillSearchInput);
