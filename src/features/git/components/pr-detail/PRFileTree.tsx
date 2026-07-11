import React from 'react';
import ChangeFileTree from '@/shared/components/ChangeFileTree';
import type { ChangeFileItem } from '@/shared/components/ChangeFileTree';
import type { PRFileChange } from '../../types';

interface PRFileTreeProps {
  files: PRFileChange[];
  onFileClick?: (path: string) => void;
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

const PRFileTree: React.FC<PRFileTreeProps> = ({ files, onFileClick, loading }) => {
  const changeFiles = React.useMemo(() => mapPRFilesToChangeFiles(files), [files]);

  if (loading) {
    return (
      <div className="p-3 space-y-1.5">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="flex items-center gap-2">
            <div className="w-3 h-3 rounded bg-bg-tertiary animate-pulse shrink-0" />
            <div
              className="h-2.5 rounded bg-bg-tertiary animate-pulse"
              style={{ width: `${60 + Math.random() * 35}%` }}
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
      showStatusDot={true}
      showBadge={true}
      className="flex-1 min-h-0 overflow-auto"
    />
  );
};

export default React.memo(PRFileTree);
