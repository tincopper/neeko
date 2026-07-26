import React from 'react';

import ChangeFileTree from '@/shared/components/ChangeFileTree';
import type { ChangeFileItem } from '@/shared/components/ChangeFileTree';

import type { PRFileChange } from '../../types';

interface PRFileTreeProps {
  files: PRFileChange[];
  onFileClick?: (path: string) => void;
  selectedPath?: string | null;
  loading?: boolean;
}

function mapPRFilesToChangeFiles(prFiles: PRFileChange[]): ChangeFileItem[] {
  return prFiles.map((f) => ({
    path: f.path,
    status: f.status as ChangeFileItem['status'],
    additions: f.additions,
    deletions: f.deletions,
  }));
}

const SKELETON_WIDTHS = [72, 85, 65, 78, 90, 70, 82, 76];

const PRFileTree: React.FC<PRFileTreeProps> = ({ files, onFileClick, selectedPath, loading }) => {
  const changeFiles = React.useMemo(() => mapPRFilesToChangeFiles(files), [files]);

  if (loading) {
    return (
      <div data-testid="file-tree-skeleton" className="p-3 space-y-1.5">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="flex items-center gap-2">
            <div className="w-3 h-3 rounded bg-bg-tertiary animate-pulse shrink-0" />
            <div
              className="h-2.5 rounded bg-bg-tertiary animate-pulse"
              style={{ width: `${SKELETON_WIDTHS[i]}%` }}
            />
          </div>
        ))}
      </div>
    );
  }

  return (
    <ChangeFileTree
      files={changeFiles}
      onFileClick={onFileClick}
      selectedPath={selectedPath}
      showStatusDot={true}
      showBadge={false}
      className="flex-1 min-h-0 overflow-auto"
    />
  );
};

export default React.memo(PRFileTree);
