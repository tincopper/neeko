import React from "react";
import { ChevronLeft, ChevronRight } from "@/components/icons"
import { cn } from "../../../utils/cn";

interface PaginationProps {
  page: number;
  totalPages: number;
  totalItems: number;
  perPage: number;
  onPageChange: (page: number) => void;
  onPerPageChange: (perPage: number) => void;
  disabled?: boolean;
}

function getPageNumbers(current: number, total: number): (number | "...")[] {
  if (total <= 7) {
    return Array.from({ length: total }, (_, i) => i + 1);
  }

  const pages: (number | "...")[] = [];
  pages.push(1);

  if (current > 3) {
    pages.push("...");
  }

  const start = Math.max(2, current - 1);
  const end = Math.min(total - 1, current + 1);
  for (let i = start; i <= end; i++) {
    pages.push(i);
  }

  if (current < total - 2) {
    pages.push("...");
  }

  pages.push(total);
  return pages;
}

const Pagination: React.FC<PaginationProps> = React.memo(
  ({ page, totalPages, totalItems, perPage, onPageChange, onPerPageChange, disabled }) => {
    if (totalItems === 0) return null;

    const start = (page - 1) * perPage + 1;
    const end = Math.min(page * perPage, totalItems);
    const pageNumbers = getPageNumbers(page, totalPages);

    return (
      <div className="flex items-center justify-between px-4 py-2 border-t border-border">
        <span className="text-[11px] text-text-muted">
          {start}-{end} of {totalItems}
        </span>

        <div className="flex items-center gap-1">
          <button
            onClick={() => onPageChange(page - 1)}
            disabled={disabled || page <= 1}
            className={cn(
              "p-1 rounded transition-colors text-text-secondary hover:text-text-primary hover:bg-bg-hover",
              (disabled || page <= 1) && "opacity-30 cursor-not-allowed"
            )}
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </button>

          {pageNumbers.map((p, i) =>
            p === "..." ? (
              <span key={`ellipsis-${i}`} className="px-1 text-[11px] text-text-muted">
                ...
              </span>
            ) : (
              <button
                key={p}
                onClick={() => onPageChange(p)}
                disabled={disabled}
                className={cn(
                  "min-w-[24px] h-6 text-[11px] rounded transition-colors",
                  p === page
                    ? "bg-accent/15 text-accent font-medium"
                    : "text-text-secondary hover:text-text-primary hover:bg-bg-hover",
                  disabled && "opacity-50 cursor-not-allowed"
                )}
              >
                {p}
              </button>
            )
          )}

          <button
            onClick={() => onPageChange(page + 1)}
            disabled={disabled || page >= totalPages}
            className={cn(
              "p-1 rounded transition-colors text-text-secondary hover:text-text-primary hover:bg-bg-hover",
              (disabled || page >= totalPages) && "opacity-30 cursor-not-allowed"
            )}
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="flex items-center gap-1.5">
          <span className="text-[11px] text-text-muted">Per page:</span>
          <select
            value={perPage}
            onChange={(e) => onPerPageChange(Number(e.target.value))}
            disabled={disabled}
            className="h-6 px-1.5 text-[11px] rounded border border-border bg-bg-secondary text-text-primary outline-none focus:border-accent-blue"
          >
            <option value={20}>20</option>
            <option value={40}>40</option>
            <option value={80}>80</option>
          </select>
        </div>
      </div>
    );
  }
);

Pagination.displayName = "Pagination";

export default Pagination;
