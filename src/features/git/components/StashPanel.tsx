import { formatRelativeTime } from '@/features/git/components/gitlog/commitListUtils';
import type { CommitFileChange, StashEntry } from '@/features/git/types';
import { ChevronDown, ChevronRight } from '@/shared/components/icons';

interface StashPanelProps {
  stashes: StashEntry[];
  loading: boolean;
  error: string | null;
  expandedSelector: string | null;
  expandedFiles: CommitFileChange[];
  filesLoading: boolean;
  filesError: string | null;
  onToggle: (selector: string) => void;
}

/** Stash 页签：列表 + 展开只读文件变更。状态与数据由组合层注入。 */
function StashPanel({
  stashes,
  loading,
  error,
  expandedSelector,
  expandedFiles,
  filesLoading,
  filesError,
  onToggle,
}: StashPanelProps) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {loading ? (
          <div className="px-2 py-1 text-[calc(var(--font-size)-1px)] text-text-muted">
            Loading stashes…
          </div>
        ) : error ? (
          <div className="px-2 py-1 text-[calc(var(--font-size)-1px)] text-danger">{error}</div>
        ) : stashes.length === 0 ? (
          <div className="px-2 py-1 text-[calc(var(--font-size)-1px)] text-text-muted">
            No stashes
          </div>
        ) : (
          <ul className="flex flex-col gap-0.5">
            {stashes.map((stash) => {
              const isExpanded = expandedSelector === stash.selector;
              return (
                <li key={stash.selector} className="rounded hover:bg-bg-hover">
                  <button
                    type="button"
                    className="flex w-full min-w-0 items-center gap-1.5 px-1.5 py-1 text-left"
                    onClick={() => onToggle(stash.selector)}
                  >
                    <span className="shrink-0 text-text-muted">
                      {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                    </span>
                    <span className="shrink-0 rounded px-1 py-px text-[calc(var(--font-size)-3px)] font-medium leading-none bg-accent-purple/15 text-accent-purple">
                      {stash.selector}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[var(--font-size)] text-text-primary leading-tight">
                      {stash.message || stash.hash}
                    </span>
                    <span className="shrink-0 text-[calc(var(--font-size)-2px)] text-text-muted">
                      {stash.branch}
                    </span>
                    <span
                      className="shrink-0 text-[calc(var(--font-size)-2px)] text-text-muted"
                      title={stash.timestamp}
                    >
                      {formatRelativeTime(stash.timestamp)}
                    </span>
                  </button>
                  {isExpanded ? (
                    <div className="ml-5 px-1.5 pb-1.5">
                      {filesLoading ? (
                        <div className="py-1 text-[calc(var(--font-size)-2px)] text-text-muted">
                          Loading files…
                        </div>
                      ) : filesError ? (
                        <div className="py-1 text-[calc(var(--font-size)-2px)] text-danger">
                          {filesError}
                        </div>
                      ) : expandedFiles.length === 0 ? (
                        <div className="py-1 text-[calc(var(--font-size)-2px)] text-text-muted">
                          No files in stash
                        </div>
                      ) : (
                        <ul className="flex flex-col">
                          {expandedFiles.map((file) => (
                            <li
                              key={file.path}
                              className="truncate py-0.5 text-[calc(var(--font-size)-2px)] text-text-secondary"
                              title={file.path}
                            >
                              <span className="mr-1.5 font-mono text-text-muted">
                                {file.status || 'M'}
                              </span>
                              {file.path}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

export default StashPanel;
