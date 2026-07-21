import React from 'react';
import {
  Plus,
  FolderDown,
  Radar,
  GitBranch,
  RefreshCw,
  ChevronDown,
} from '@/shared/components/icons';
import {
  Button,
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/ui';
import {
  skillMenuContentClass,
  skillMenuItemClass,
} from './skillMenuStyles';

interface SkillHeaderProps {
  onCreateClick: () => void;
  onInstallDirectoryClick: () => void;
  onInstallGitClick: () => void;
  onScanClick: () => void;
  onRefreshMetadataClick?: () => void;
  filterLabel?: string | null;
  count?: number;
}

/**
 * Library toolbar: title + compact actions.
 */
const SkillHeader: React.FC<SkillHeaderProps> = React.memo(
  ({
    onCreateClick,
    onInstallDirectoryClick,
    onInstallGitClick,
    onScanClick,
    onRefreshMetadataClick,
    filterLabel,
    count,
  }) => {
    return (
      <div className="flex items-center gap-3 px-4 h-11 shrink-0 border-b border-border">
        <div className="min-w-0 flex items-center gap-2 flex-1">
          <h2 className="text-sm font-semibold text-text-primary truncate">
            {filterLabel ?? 'Library'}
          </h2>
          {typeof count === 'number' && (
            <span className="inline-flex items-center justify-center min-w-[1.5rem] h-5 px-1.5 rounded-full text-[11px] tabular-nums bg-bg-hover text-text-muted border border-border">
              {count}
            </span>
          )}
        </div>
        <div className="flex items-center gap-0.5 shrink-0">
          <Button
            variant="ghost"
            size="sm"
            onClick={onCreateClick}
            className="h-7 px-2.5 text-xs gap-1 text-text-secondary hover:text-text-primary hover:bg-bg-hover"
          >
            <Plus className="h-3.5 w-3.5" />
            Create
          </Button>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2.5 text-xs gap-1 text-text-secondary hover:text-text-primary hover:bg-bg-hover data-[state=open]:bg-bg-hover data-[state=open]:text-text-primary"
              >
                <FolderDown className="h-3.5 w-3.5" />
                Install
                <ChevronDown className="h-3 w-3 opacity-60" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              sideOffset={6}
              className={skillMenuContentClass('w-[200px]')}
            >
              <DropdownMenuItem
                className={skillMenuItemClass()}
                onSelect={onInstallDirectoryClick}
              >
                <FolderDown className="h-3.5 w-3.5" />
                <span className="flex-1">From directory</span>
              </DropdownMenuItem>
              <DropdownMenuItem
                className={skillMenuItemClass()}
                onSelect={onInstallGitClick}
              >
                <GitBranch className="h-3.5 w-3.5" />
                <span className="flex-1">From Git / GitHub</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <Button
            variant="ghost"
            size="sm"
            onClick={onScanClick}
            className="h-7 px-2.5 text-xs gap-1 text-text-secondary hover:text-text-primary hover:bg-bg-hover"
            title="Scan agent skill directories"
          >
            <Radar className="h-3.5 w-3.5" />
            Scan
          </Button>
          {onRefreshMetadataClick && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onRefreshMetadataClick}
              className="h-7 px-2.5 text-xs gap-1 text-text-secondary hover:text-text-primary hover:bg-bg-hover"
              title="Re-read SKILL.md descriptions into the library"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Meta
            </Button>
          )}
        </div>
      </div>
    );
  },
);

SkillHeader.displayName = 'SkillHeader';

export default SkillHeader;
