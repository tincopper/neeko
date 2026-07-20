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
}

const SkillHeader: React.FC<SkillHeaderProps> = React.memo(
  ({ onCreateClick, onInstallDirectoryClick, onInstallGitClick, onScanClick }) => {
    return (
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <span className="text-sm font-semibold text-text-primary">Local Skills</span>
        <div className="flex gap-1.5">
          <Button
            variant="ghost"
            size="sm"
            onClick={onCreateClick}
            className="h-7 px-2.5 text-xs gap-1"
          >
            <Plus className="h-3.5 w-3.5" />
            Create
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="h-7 px-2.5 text-xs gap-1">
                <FolderDown className="h-3.5 w-3.5" />
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
            className="h-7 px-2.5 text-xs gap-1"
          >
            <Radar className="h-3.5 w-3.5" />
            Scan
          </Button>
        </div>
      </div>
    );
  },
);

SkillHeader.displayName = 'SkillHeader';

export default SkillHeader;
