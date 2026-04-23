import React from "react";
import { Search } from "lucide-react";
import { Input } from "../ui";

interface SkillSearchBarProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}

const SkillSearchBar: React.FC<SkillSearchBarProps> = React.memo(
  ({ value, onChange, placeholder = "Search skills..." }) => {
    return (
      <div className="px-4 py-2 border-b border-border">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-text-muted" />
          <Input
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={placeholder}
            className="h-8 pl-8 text-xs"
          />
        </div>
      </div>
    );
  }
);

SkillSearchBar.displayName = "SkillSearchBar";

export default SkillSearchBar;
