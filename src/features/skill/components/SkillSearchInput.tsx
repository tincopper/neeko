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

const SkillSearchInput: React.FC<SkillSearchInputProps> = ({
  value,
  onChange,
  placeholder = 'Search skills in the library…',
  clearable = false,
  className,
}) => {
  return (
    <div className={cn('px-4 py-2.5 border-b border-border shrink-0', className)}>
      <div className="relative flex items-center max-w-xl">
        <Search className="absolute left-2.5 h-3.5 w-3.5 text-text-muted pointer-events-none" />
        <input
          type="text"
          role="textbox"
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          className={cn(
            'w-full h-8 pl-8 text-[var(--font-size)] rounded-lg',
            'bg-bg-hover/50 border border-border/80',
            'text-text-primary placeholder:text-text-muted',
            'outline-none focus:border-border focus:bg-bg-primary transition-colors',
            clearable && value ? 'pr-8' : 'pr-3',
          )}
        />
        {clearable && value ? (
          <button
            type="button"
            onClick={() => onChange('')}
            className="absolute right-2 p-0.5 text-text-muted hover:text-text-primary rounded"
            aria-label="Clear search"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        ) : null}
      </div>
    </div>
  );
};

export default React.memo(SkillSearchInput);
