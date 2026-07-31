/** 加载骨架（虚拟列表占位，8 行脉冲） */
export function CommitListLoading() {
  return (
    <div
      className="h-full overflow-hidden px-1 py-1 space-y-1"
      aria-busy="true"
      aria-label="Loading"
    >
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="flex items-center gap-2 h-8 animate-pulse">
          <div className="w-2 h-2 rounded-full bg-bg-tertiary shrink-0" />
          <div className="flex-1 space-y-1.5 min-w-0">
            <div className="h-2.5 rounded bg-bg-tertiary w-[75%]" />
            <div className="h-2 rounded bg-bg-tertiary/70 w-[40%]" />
          </div>
        </div>
      ))}
    </div>
  );
}

/** 空态：无 commit 或搜索无结果（可带清除搜索按钮） */
export function CommitListEmpty({
  searching,
  onClearSearch,
}: {
  searching: boolean;
  onClearSearch?: () => void;
}) {
  return (
    <div className="flex-1 h-full flex flex-col items-center justify-center gap-2 text-[var(--font-size)] text-text-muted px-3">
      <span>{searching ? 'No matching commits' : 'No commits yet'}</span>
      {searching && onClearSearch ? (
        <button
          type="button"
          className="text-accent-blue hover:underline text-[calc(var(--font-size)-1px)]"
          onClick={onClearSearch}
        >
          Clear filter
        </button>
      ) : null}
    </div>
  );
}
