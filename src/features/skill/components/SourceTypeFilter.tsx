import React from 'react';
import { HardDrive, GitBranch, Store } from 'lucide-react';
import { useSkillStore } from '@/features/skill/store';
import { cn } from '@/lib/utils';

const SOURCES: Array<{ value: 'all' | 'local' | 'git' | 'skillssh'; label: string; icon?: React.ReactNode }> = [
  { value: 'all', label: 'All' },
  { value: 'local', label: 'Local', icon: <HardDrive className="h-3 w-3" /> },
  { value: 'git', label: 'Git', icon: <GitBranch className="h-3 w-3" /> },
  { value: 'skillssh', label: 'skills.sh', icon: <Store className="h-3 w-3" /> },
];

const SourceTypeFilter: React.FC = React.memo(() => {
  const sourceFilter = useSkillStore((s) => s.sourceFilter);
  const setSourceFilter = useSkillStore((s) => s.setSourceFilter);

  return (
    <div className="flex items-center gap-1 px-4 py-1.5 border-b border-border shrink-0">
      <span className="text-[10.5px] font-bold tracking-[0.12em] uppercase text-text-muted shrink-0 mr-1">
        Source
      </span>
      {SOURCES.map(({ value, label, icon }) => (
        <button
          key={value}
          type="button"
          onClick={() => setSourceFilter(value)}
          className={cn(
            'shrink-0 inline-flex items-center gap-1 h-6 px-2 text-[11px] rounded-md transition-colors',
            sourceFilter === value
              ? 'bg-bg-selected text-text-primary'
              : 'text-text-secondary hover:bg-bg-hover',
          )}
        >
          {icon}
          <span>{label}</span>
        </button>
      ))}
    </div>
  );
});

SourceTypeFilter.displayName = 'SourceTypeFilter';

export default SourceTypeFilter;
