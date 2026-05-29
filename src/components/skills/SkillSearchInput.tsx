import React from 'react';
import { Search, X } from 'lucide-react';
import { Input } from '@/ui/input';
import { cn } from '../../utils/cn';

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
  placeholder = 'Search...',
  clearable = false,
  className,
}) => {
  return (
    <div className={cn('relative flex items-center', className)}>
      <Search className="absolute left-2.5 h-3.5 w-3.5 text-text-muted pointer-events-none shrink-0" />
      <Input
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className={cn('pl-8 h-7 text-xs bg-transparent border-0 border-b border-border rounded-none focus-visible:ring-0', clearable && value ? 'pr-7' : '')}
      />
      {clearable && value && (
        <button
          onClick={() => onChange('')}
          className="absolute right-2 text-text-muted hover:text-text-primary"
          type="button"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
};

export default React.memo(SkillSearchInput);
