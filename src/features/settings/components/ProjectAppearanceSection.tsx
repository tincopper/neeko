/** 项目外观：头像色板（受控组件，状态归父级）。 */

import { cn } from '@/lib/utils';
import { AVATAR_COLORS } from '@/shared/utils/projectAvatar';

interface Props {
  avatarColor: string | null | undefined;
  onChange: (color: string | null) => void;
}

export default function ProjectAppearanceSection({ avatarColor, onChange }: Props) {
  return (
    <div className="mb-6">
      <div className="text-[0.86em] text-text-primary font-medium mb-1">Appearance</div>
      <div className="text-[0.79em] text-text-muted mb-3">
        Avatar color shown in the project list and title bar.
      </div>
      <div className="flex items-center gap-2" data-testid="appearance-swatches">
        {AVATAR_COLORS.map((color) => {
          const selected = avatarColor === color;
          return (
            <button
              key={color}
              type="button"
              title={color}
              aria-label={`Select avatar color ${color}`}
              aria-pressed={selected}
              onClick={() => onChange(color)}
              className={cn(
                'w-6 h-6 rounded-full transition-transform shrink-0 cursor-pointer',
                selected && 'ring-2 ring-white/80 scale-110',
              )}
              style={{ backgroundColor: color }}
            />
          );
        })}
        {avatarColor != null && (
          <button
            type="button"
            onClick={() => onChange(null)}
            className="ml-2 text-[0.79em] text-text-muted hover:text-text-primary transition-colors cursor-pointer"
            data-testid="appearance-reset"
          >
            Reset to default
          </button>
        )}
      </div>
    </div>
  );
}
