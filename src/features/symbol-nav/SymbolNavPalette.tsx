/**
 * Shared palette for File Structure and Find Usages results.
 */
import React, { useEffect, useRef } from "react";

import { Dialog, DialogContent, DialogTitle } from "@/ui/dialog";
import { cn } from "@/lib/utils";

import { useSymbolNavStore } from "./symbolNavStore";

export function SymbolNavPalette() {
  const open = useSymbolNavStore((s) => s.open);
  const mode = useSymbolNavStore((s) => s.mode);
  const title = useSymbolNavStore((s) => s.title);
  const query = useSymbolNavStore((s) => s.query);
  const items = useSymbolNavStore((s) => s.items);
  const selectedIndex = useSymbolNavStore((s) => s.selectedIndex);
  const loading = useSymbolNavStore((s) => s.loading);
  const setQuery = useSymbolNavStore((s) => s.setQuery);
  const moveSelection = useSymbolNavStore((s) => s.moveSelection);
  const confirm = useSymbolNavStore((s) => s.confirm);
  const close = useSymbolNavStore((s) => s.close);

  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) {
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  useEffect(() => {
    const el = listRef.current?.querySelector(`[data-idx="${selectedIndex}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      moveSelection(1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      moveSelection(-1);
    } else if (e.key === "Enter") {
      e.preventDefault();
      void confirm();
    } else if (e.key === "Escape") {
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
        className="max-w-[560px] p-0 gap-0 overflow-hidden"
        showCloseButton={false}
        data-symbol-nav
        data-quick-open
        onKeyDown={onKeyDown}
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <DialogTitle className="sr-only">{title}</DialogTitle>
        <div className="px-3 pt-3 pb-2 border-b border-border">
          <div className="text-[11px] uppercase tracking-wide text-text-muted mb-1.5 px-0.5">
            {title}
            {loading ? " · loading…" : ""}
          </div>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={
              mode === "structure" ? "Filter symbols…" : "Filter usages…"
            }
            className={cn(
              "w-full px-3 py-2 rounded-md text-[13px]",
              "bg-bg-primary border border-border text-text-primary",
              "placeholder:text-text-muted outline-none focus:border-accent-blue",
            )}
            autoComplete="off"
            spellCheck={false}
          />
        </div>
        <div
          ref={listRef}
          className="max-h-[min(360px,50vh)] overflow-y-auto py-1"
          role="listbox"
        >
          {items.length === 0 ? (
            <div className="px-4 py-6 text-center text-[13px] text-text-muted">
              {loading
                ? "Loading symbols…"
                : mode === "structure"
                  ? "No symbols in this file"
                  : "No usages found"}
            </div>
          ) : (
            items.map((item, idx) => (
              <button
                key={item.id}
                type="button"
                data-idx={idx}
                role="option"
                aria-selected={idx === selectedIndex}
                className={cn(
                  "w-full text-left px-3 py-2 flex flex-col gap-0.5 cursor-pointer border-0 bg-transparent",
                  idx === selectedIndex
                    ? "bg-accent-blue/15 text-text-primary"
                    : "text-text-secondary hover:bg-bg-hover",
                )}
                onMouseEnter={() =>
                  useSymbolNavStore.setState({ selectedIndex: idx })
                }
                onClick={() => {
                  useSymbolNavStore.setState({ selectedIndex: idx });
                  void confirm();
                }}
              >
                <span className="text-[13px] font-medium truncate font-mono">
                  {item.label}
                </span>
                {item.description ? (
                  <span className="text-[11px] text-text-muted truncate">
                    {item.description}
                  </span>
                ) : null}
              </button>
            ))
          )}
        </div>
        <div className="px-3 py-1.5 border-t border-border text-[10px] text-text-muted flex gap-3">
          <span>↑↓ navigate</span>
          <span>↵ go to</span>
          <span>esc close</span>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default SymbolNavPalette;
