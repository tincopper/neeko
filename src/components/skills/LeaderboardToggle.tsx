import React from "react";
import { Flame, TrendingUp, Star } from "lucide-react";
import { cn } from "../../utils/cn";
import type { LeaderboardType } from "../../hooks/useMarketplace";

interface LeaderboardToggleProps {
  value: LeaderboardType;
  onChange: (value: LeaderboardType) => void;
  disabled?: boolean;
}

interface BoardOption {
  key: LeaderboardType;
  label: string;
  icon: React.ElementType;
}

const boardOptions: BoardOption[] = [
  { key: "hot", label: "Hot", icon: Flame },
  { key: "trending", label: "Trending", icon: TrendingUp },
  { key: "alltime", label: "All Time", icon: Star },
];

const LeaderboardToggle: React.FC<LeaderboardToggleProps> = React.memo(
  ({ value, onChange, disabled }) => {
    return (
      <div className="flex gap-1 px-4 py-2 border-b border-border">
        {boardOptions.map((option) => {
          const Icon = option.icon;
          const isActive = value === option.key;
          return (
            <button
              key={option.key}
              onClick={() => onChange(option.key)}
              disabled={disabled}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md transition-colors",
                isActive
                  ? "bg-accent/15 text-accent"
                  : "text-text-secondary hover:bg-bg-hover hover:text-text-primary",
                disabled && "opacity-50 cursor-not-allowed"
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {option.label}
            </button>
          );
        })}
      </div>
    );
  }
);

LeaderboardToggle.displayName = "LeaderboardToggle";

export default LeaderboardToggle;
