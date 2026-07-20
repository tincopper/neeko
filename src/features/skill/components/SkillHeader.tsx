import React from 'react';
import { Plus, FolderDown, Radar, GitBranch } from '@/shared/components/icons';
import {
  Button,
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/ui';

interface SkillHeaderProps {
  onCreateClick: () => void;
  onInstallDirectoryClick: () => void;
  onInstallGitClick: () => void;
  onScanClick: () => void;
  /** Optional filter context, e.g. active tag group name */
  filterLabel?: string | null;
  count?: number;
}

const SkillHeader: React.FC<SkillHeaderProps> = React.memo(
  ({
    onCreateClick,
    onInstallDirectoryClick,
    onInstallGitClick,
    onScanClick,
    filterLabel,
    count,
  }) => {
    return (
      <div className="flex items-center gap-2 px-3 h-9 shrink-0 border-b border-border">
        <div className="min-w-0 flex-1 flex items-baseline gap-2">
          <span className="text-[var(--font-size)] font-semibold text-text-primary truncate">
            {filterLabel ? filterLabel : 'Local Skills'}
          </span>
          {typeof count === 'number' && (
            <span className="text-[10.5px] text-text-muted tabular-nums">{count}</span>
          )}
        </div>
        <div className="flex items-center gap-0.5 shrink-0">
          <Button
            variant="ghost"
            size="sm"
            onClick={onCreateClick}
            className="h-6 px-2 text-[11px] gap-1 text-text-secondary hover:text-text-primary"
          >
            <Plus className="h-3 w-3" />
            Create
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-[11px] gap-1 text-text-secondary hover:text-text-primary"
              >
                <FolderDown className="h-3 w-3" />
                Install
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              <DropdownMenuItem
                className="flex items-center gap-2 cursor-pointer text-xs"
                onSelect={onInstallDirectoryClick}
              >
                <FolderDown className="h-3.5 w-3.5" />
                From directory
              </DropdownMenuItem>
              <DropdownMenuItem
                className="flex items-center gap-2 cursor-pointer text-xs"
                onSelect={onInstallGitClick}
              >
                <GitBranch className="h-3.5 w-3.5" />
                From Git / GitHub
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button
            variant="ghost"
            size="sm"
            onClick={onScanClick}
            className="h-6 px-2 text-[11px] gap-1 text-text-secondary hover:text-text-primary"
            title="Scan agent skill directories"
          >
            <Radar className="h-3 w-3" />
            Scan
          </Button>
        </div>
      </div>
    );
  },
);

SkillHeader.displayName = 'SkillHeader';

export default SkillHeader;
