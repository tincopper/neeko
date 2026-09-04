import { useLspStore } from '@/shared/store/lspStore';

/** 左簇常驻项：扩展路由冲突提示（无冲突时隐藏）。 */
export function ConflictsItem() {
  const extensionConflicts = useLspStore((s) => s.extensionConflicts);

  if (extensionConflicts.length === 0) return null;

  const title = extensionConflicts
    .map(
      (c) =>
        `*.${c.extension}: ${c.winnerLanguageId} wins over ${c.displacedLanguageIds.join(', ')}`,
    )
    .join('\n');

  return (
    <span
      className="flex items-center gap-1 text-status-running truncate max-w-[220px]"
      title={title}
    >
      <span className="w-1.5 h-1.5 rounded-full shrink-0 bg-status-running" />
      <span className="truncate">
        {extensionConflicts.length === 1
          ? `*.${extensionConflicts[0].extension} conflict`
          : `${extensionConflicts.length} ext conflicts`}
      </span>
    </span>
  );
}
