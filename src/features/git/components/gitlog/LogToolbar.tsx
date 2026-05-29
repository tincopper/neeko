import React from "react";
import { SearchIcon } from "@/shared/components/icons";
import { RefreshCw } from "@/shared/components/icons"
import { cn } from "../../../../utils/cn";

interface LogToolbarProps {
  searchQuery: string;
  onSearchChange: (query: string) => void;
  onRefresh: () => void;
  loading: boolean;
}

const LogToolbar: React.FC<LogToolbarProps> = ({
  searchQuery,
  onSearchChange,
  onRefresh,
  loading,
}) => {
  return (
    <div className="flex items-center gap-1.5 px-2 py-1 bg-bg-tertiary/50 rounded-md shrink-0">
      <SearchIcon size={12} className="text-text-muted shrink-0" />
      <input
        type="text"
        className="flex-1 bg-transparent border-none outline-none text-[var(--font-size)] text-text-primary placeholder:text-text-muted"
        placeholder="Search commits..."
        value={searchQuery}
        onChange={(e) => onSearchChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") onSearchChange("");
        }}
      />
      {searchQuery && (
        <button
          className="text-text-muted hover:text-text-secondary text-[calc(var(--font-size)-2px)] px-1"
          onClick={() => onSearchChange("")}
        >
          x
        </button>
      )}
      <button
        className={cn(
          "p-0.5 rounded text-text-muted hover:text-accent-blue hover:bg-bg-hover transition-colors duration-100",
          loading && "animate-spin",
        )}
        title="Refresh"
        onClick={onRefresh}
        disabled={loading}
      >
        <RefreshCw size={12} />
      </button>
    </div>
  );
};

export default React.memo(LogToolbar);
