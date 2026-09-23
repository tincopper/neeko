/**
 * References Peek（VSCode 式左列表右预览）。
 *
 * 数据全来自 `referencesPeekStore`；本组件只渲染 + 键盘导航。
 * `SymbolNavPalette`（Shift+F12）保持不动——加法不碰既有行为。
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';

import { cn } from '@/lib/utils';
import { canonicalFsPath } from '@/shared/utils/fileRef';
import { getFileName } from '@/shared/utils/fileTree';
import { Dialog, DialogContent, DialogTitle } from '@/ui/Dialog';

import {
  PEEK_TREE_WIDTH_DEFAULT,
  PEEK_TREE_WIDTH_MAX,
  PEEK_TREE_WIDTH_MIN,
  clampPeekTreeWidth,
} from './referencesPeek';
import { ReferencesPeekPreview } from './ReferencesPeekPreview';
import {
  PEEK_MAX_ITEMS,
  peekItemAt,
  useReferencesPeekStore,
  type PeekViewItem,
} from './store/referencesPeekStore';

/**
 * 目录展示段：经**身份所有者**做词法归一（反斜杠 / 重复斜杠）后取父目录。
 * 纯展示派生、不参与同文件判定；归一不得自造（红线 12），故取 `canonicalFsPath`。
 */
function dirOf(filePath: string): string {
  const unified = canonicalFsPath('', filePath);
  const cut = unified.lastIndexOf('/');
  return cut > 0 ? unified.slice(0, cut) : '';
}

function PreviewPane({ item }: { item: PeekViewItem | undefined }) {
  if (!item || item.previewLines.length === 0) {
    return (
      <div className="flex-1 min-w-0 px-4 py-6 text-center text-[13px] text-text-muted">
        Preview unavailable
      </div>
    );
  }
  return (
    <div className="flex-1 min-h-0 min-w-0 flex flex-col overflow-hidden">
      <div className="px-4 pt-2 pb-1 text-[11px] text-text-muted truncate font-mono">
        {item.filePath}
      </div>
      <ReferencesPeekPreview
        filePath={item.filePath}
        lines={item.previewLines}
        baseLine0={item.previewBaseLine0}
        matchLineIdx={item.previewMatchIdx}
        matchStartChar={item.matchStartChar}
        matchEndChar={item.matchEndChar}
      />
    </div>
  );
}

function ReferencesPeekDialogView() {
  const open = useReferencesPeekStore((s) => s.open);
  const title = useReferencesPeekStore((s) => s.title);
  const loading = useReferencesPeekStore((s) => s.loading);
  const truncated = useReferencesPeekStore((s) => s.truncated);
  const groups = useReferencesPeekStore((s) => s.groups);
  const selectedIndex = useReferencesPeekStore((s) => s.selectedIndex);
  const moveSelection = useReferencesPeekStore((s) => s.moveSelection);
  const setSelectedIndex = useReferencesPeekStore((s) => s.setSelectedIndex);
  const confirm = useReferencesPeekStore((s) => s.confirm);
  const close = useReferencesPeekStore((s) => s.close);

  const listRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const dragCleanupRef = useRef<(() => void) | null>(null);
  const [treeWidth, setTreeWidth] = useState(PEEK_TREE_WIDTH_DEFAULT);

  // 每组首条的扁平序号 + 总条目数（O(组数) 一次算完，替代逐条回溯累加）。
  const { groupStartIdx, totalItems } = useMemo(() => {
    const starts: number[] = [];
    let n = 0;
    for (const g of groups) {
      starts.push(n);
      n += g.items.length;
    }
    return { groupStartIdx: starts, totalItems: n };
  }, [groups]);

  const selected = peekItemAt(groups, selectedIndex);

  /** 分隔条拖拽：window 级 move/up，up 时解绑（与终端 resize 同模式）。 */
  const onDividerMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    dragRef.current = { startX: e.clientX, startWidth: treeWidth };
    const onMove = (ev: MouseEvent) => {
      const d = dragRef.current;
      if (d) setTreeWidth(clampPeekTreeWidth(d.startWidth + ev.clientX - d.startX));
    };
    const onUp = () => {
      dragRef.current = null;
      dragCleanupRef.current = null;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    dragCleanupRef.current = onUp;
  };

  // 拖拽途中弹窗被关闭/卸载（Esc、点遮罩）时 mouseup 不再到达本组件 —— 兜底解绑，
  // 否则 window 监听悬挂并继续对已卸载组件 setState。
  useEffect(() => () => dragCleanupRef.current?.(), []);

  const onDividerKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      setTreeWidth((w) => clampPeekTreeWidth(w + 10));
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      setTreeWidth((w) => clampPeekTreeWidth(w - 10));
    }
  };

  // 打开即把焦点收进列表：`onOpenAutoFocus` 被 preventDefault（避免遮挡点击目标），
  // Radix 不会代劳落焦点；不补偿则 keydown 留在编辑器上，↑↓ / ↵ 永不进入本组件
  // （与 SymbolNavPalette 的 inputRef.focus() 同款补偿）。
  useEffect(() => {
    if (!open) return;
    requestAnimationFrame(() => listRef.current?.focus());
  }, [open]);

  useEffect(() => {
    const el = listRef.current?.querySelector(`[data-idx="${selectedIndex}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      moveSelection(1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      moveSelection(-1);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      void confirm();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      close();
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) close();
      }}
    >
      <DialogContent
        className="w-[94vw] max-w-[1600px] h-[80vh] max-h-[900px] min-w-[640px] min-h-[380px] p-0 gap-0 overflow-auto resize flex flex-col"
        showCloseButton={false}
        data-references-peek
        data-quick-open
        onKeyDown={onKeyDown}
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <DialogTitle className="sr-only">{title}</DialogTitle>
        <div className="px-3 pt-3 pb-2 border-b border-border shrink-0">
          <div className="text-[11px] uppercase tracking-wide text-text-muted mb-1 px-0.5">
            {title}
            {loading ? ' · loading…' : ''}
            {truncated && !loading ? ` · showing first ${PEEK_MAX_ITEMS}` : ''}
          </div>
        </div>
        <div className="flex flex-1 min-h-[280px] min-w-0">
          <div
            ref={listRef}
            data-testid="peek-tree"
            style={{ width: treeWidth }}
            className="min-h-0 min-w-0 shrink-0 overflow-y-auto py-1 focus:outline-none"
            role="listbox"
            tabIndex={-1}
          >
            {totalItems === 0 ? (
              <div className="px-4 py-6 text-center text-[13px] text-text-muted">
                {loading ? 'Loading references…' : 'No references found'}
              </div>
            ) : (
              groups.map((g, gi) => (
                <div key={g.uri}>
                  <div className="px-3 py-1 text-[12px]" title={g.filePath}>
                    <div className="flex items-center gap-1.5">
                      <span className="font-bold truncate">{getFileName(g.filePath)}</span>
                      <span className="ml-auto pl-3 shrink-0">{g.items.length}</span>
                    </div>
                    <div className="text-text-muted truncate text-[11px]">{dirOf(g.filePath)}</div>
                  </div>
                  {g.items.map((item, ii) => {
                    const flat = (groupStartIdx[gi] ?? 0) + ii;
                    const lineNo = item.location.range.start.line + 1;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        data-idx={flat}
                        role="option"
                        aria-selected={flat === selectedIndex}
                        className={cn(
                          'w-full text-left pl-7 pr-3 py-1 font-mono text-[12.5px] truncate cursor-pointer border-0 bg-transparent',
                          flat === selectedIndex
                            ? 'bg-accent-blue/15 text-text-primary'
                            : 'text-text-secondary hover:bg-bg-hover',
                        )}
                        onMouseEnter={() => setSelectedIndex(flat)}
                        onClick={() => setSelectedIndex(flat)}
                        onDoubleClick={() => {
                          setSelectedIndex(flat);
                          void confirm();
                        }}
                        title={item.snippet || `${item.filePath}:${lineNo}`}
                      >
                        {item.snippet || `${getFileName(item.filePath)}:${lineNo}`}
                      </button>
                    );
                  })}
                </div>
              ))
            )}
          </div>
          <div
            role="slider"
            aria-label="调整列表宽度"
            aria-valuemin={PEEK_TREE_WIDTH_MIN}
            aria-valuemax={PEEK_TREE_WIDTH_MAX}
            aria-valuenow={treeWidth}
            tabIndex={0}
            title="拖拽或 ←→ 调整列表宽度"
            onMouseDown={onDividerMouseDown}
            onKeyDown={onDividerKeyDown}
            className="w-1 shrink-0 cursor-col-resize hover:bg-accent-blue/40 active:bg-accent-blue/60 focus-visible:bg-accent-blue/60 focus-visible:outline-none"
          />
          <PreviewPane item={selected} />
        </div>
        <div className="px-3 py-1.5 border-t border-border text-[10px] text-text-muted flex gap-3 shrink-0">
          <span>↑↓ navigate</span>
          <span>↵ go to</span>
          <span>esc close</span>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export const ReferencesPeekDialog = React.memo(ReferencesPeekDialogView);
