import React from "react";
import { Search, X } from "@/components/icons"
import { Input } from "../ui";

interface MarketplaceSearchBarProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}

const MarketplaceSearchBar: React.FC<MarketplaceSearchBarProps> = React.memo(
  ({ value, onChange, placeholder = "Search marketplace..." }) => {
    return (
      <div className="px-4 py-2 border-b border-border">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-text-muted" />
          <Input
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={placeholder}
            className="h-8 pl-8 pr-8 text-xs"
          />
          {value && (
            <button
              onClick={() => onChange("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>
    );
  }
);

MarketplaceSearchBar.displayName = "MarketplaceSearchBar";

export default MarketplaceSearchBar;
