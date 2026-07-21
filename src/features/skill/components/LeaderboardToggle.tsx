import React from 'react';
import { Flame, TrendingUp, Star } from '@/shared/components/icons';
import { cn } from '@/lib/utils';
import type { LeaderboardType } from '@/features/skill/hooks/useMarketplace';

interface LeaderboardToggleProps {
  value: LeaderboardType;
  onChange: (value: LeaderboardType) => void;
  disabled?: boolean;
}

const boardOptions: Array<{
  key: LeaderboardType;
  label: string;
  icon: React.ElementType;
}> = [
  { key: 'hot', label: 'Hot', icon: Flame },
  { key: 'trending', label: 'Trending', icon: TrendingUp },
  { key: 'alltime', label: 'All time', icon: Star },
];

const LeaderboardToggle: React.FC<LeaderboardToggleProps> = React.memo(
  ({ value, onChange, disabled }) => {
    return (
      <div className="flex items-center gap-0.5 px-2 py-1.5 border-b border-border shrink-0">
        {boardOptions.map(option => {
          const Icon = option.icon;
          const isActive = value === option.key;
          return (
            <button
              key={option.key}
              type="button"
              onClick={() => onChange(option.key)}
              disabled={disabled}
              className={cn(
                'flex items-center gap-1 h-6 px-2 text-[11px] rounded-md transition-colors duration-150',
                isActive
                  ? 'bg-bg-selected text-text-primary'
                  : 'text-text-secondary hover:bg-bg-hover hover:text-text-primary',
                disabled && 'opacity-50 cursor-not-allowed',
              )}
            >
              <Icon className="h-3 w-3" />
              {option.label}
            </button>
          );
        })}
      </div>
    );
  },
);

LeaderboardToggle.displayName = 'LeaderboardToggle';

export default LeaderboardToggle;
