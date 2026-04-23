import React, { useState, useMemo } from "react";
import { X, Search } from "lucide-react";
import { cn } from "../../utils/cn";

interface SourceFilterProps {
  sources: string[];
  value: string | null;
  onChange: (value: string | null) => void;
  disabled?: boolean;
}

const SourceFilter: React.FC<SourceFilterProps> = React.memo(
  ({ sources, value, onChange, disabled }) => {
    const [query, setQuery] = useState("");

    const filteredSources = useMemo(() => {
      if (!query.trim()) return sources;
      const q = query.toLowerCase();
      return sources.filter((s) => s.toLowerCase().includes(q));
    }, [sources, query]);

    if (sources.length === 0) return null;

    return (
      <div className="flex items-center gap-1.5 px-4 py-2 border-b border-border overflow-x-auto">
        <span className="text-[10px] text-text-muted uppercase tracking-wider shrink-0">
          Source:
        </span>
        <div className="relative shrink-0">
          <Search className="absolute left-1.5 top-1/2 -translate-y-1/2 h-3 w-3 text-text-muted" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter..."
            disabled={disabled}
            className="h-6 w-24 pl-5 pr-1.5 text-[11px] rounded border border-border bg-bg-secondary text-text-primary placeholder:text-text-muted outline-none focus:border-accent-blue"
          />
        </div>
        <button
          onClick={() => onChange(null)}
          disabled={disabled}
          className={cn(
            "shrink-0 px-2.5 py-1 text-[11px] rounded-full border transition-colors",
            value === null
              ? "bg-accent/15 text-accent border-accent/30"
              : "text-text-secondary border-border hover:bg-bg-hover hover:text-text-primary",
            disabled && "opacity-50 cursor-not-allowed"
          )}
        >
          All
        </button>
        {filteredSources.map((source) => (
          <button
            key={source}
            onClick={() => onChange(source === value ? null : source)}
            disabled={disabled}
            className={cn(
              "shrink-0 flex items-center gap-1 px-2.5 py-1 text-[11px] rounded-full border transition-colors",
              value === source
                ? "bg-accent/15 text-accent border-accent/30"
                : "text-text-secondary border-border hover:bg-bg-hover hover:text-text-primary",
              disabled && "opacity-50 cursor-not-allowed"
            )}
          >
            <img
              src={`https://github.com/${source}.png?size=16`}
              alt=""
              className="w-3 h-3 rounded-sm"
              loading="lazy"
            />
            {source}
            {value === source && (
              <X className="h-2.5 w-2.5 ml-0.5" />
            )}
          </button>
        ))}
      </div>
    );
  }
);

SourceFilter.displayName = "SourceFilter";

export default SourceFilter;
