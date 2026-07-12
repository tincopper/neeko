import React, { useMemo } from 'react';

import type { PRFileChange } from '../../types';

interface FileStatsBarProps {
  files: PRFileChange[];
}

const FileStatsBar: React.FC<FileStatsBarProps> = ({ files }) => {
  const { totalFiles, totalAdditions, totalDeletions } = useMemo(() => {
    let adds = 0;
    let dels = 0;
    for (const f of files) {
      adds += f.additions ?? 0;
      dels += f.deletions ?? 0;
    }
    return { totalFiles: files.length, totalAdditions: adds, totalDeletions: dels };
  }, [files]);

  if (files.length === 0) return null;

  return (
    <div className="flex items-center gap-1.5 px-4 py-2 text-[calc(var(--font-size)-1px)] text-text-muted border-b border-border whitespace-nowrap">
      <span className="font-medium text-text-primary">{totalFiles}</span>
      <span>file{totalFiles !== 1 ? 's' : ''} changed</span>
      {totalAdditions > 0 && (
        <span className="text-accent-green font-medium">+{totalAdditions}</span>
      )}
      {totalDeletions > 0 && <span className="text-accent-red font-medium">-{totalDeletions}</span>}
    </div>
  );
};

export default React.memo(FileStatsBar);
