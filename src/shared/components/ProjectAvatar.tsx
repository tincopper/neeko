import React from 'react';
import { cn } from '@/lib/utils';
import { getAvatarStyle, getProjectInitials } from '@/shared/utils/projectAvatar';
import neekoIcon from '@/assets/neeko-icon.png';

interface ProjectAvatarProps {
  /** Project display name. When missing/empty, falls back to the Neeko icon. */
  name?: string | null;
  /** Optional palette color override (`avatar_color` from the project). */
  color?: string | null;
  /** Outer box size in px. Default 16 to match message-header icons. */
  size?: number;
  className?: string;
}

/**
 * Compact project avatar used in message headers and similar tight slots.
 * Reuses the same palette/initials language as the project card
 * (`getAvatarStyle` + `getProjectInitials`); falls back to the Neeko logo
 * when no project name is available.
 */
const ProjectAvatar: React.FC<ProjectAvatarProps> = React.memo(
  ({ name, color, size = 16, className }) => {
    const hasName = Boolean(name && name.trim());

    if (!hasName) {
      return (
        <img
          src={neekoIcon}
          alt="Neeko"
          width={size}
          height={size}
          className={cn('shrink-0 rounded-md object-cover', className)}
          style={{ width: size, height: size }}
        />
      );
    }

    const style = getAvatarStyle({ name: name!, color });
    const initials = getProjectInitials(name!);
    // Keep initials readable at small sizes (message header ~16px).
    const fontSize = Math.max(9, Math.round(size * 0.55));

    return (
      <span
        className={cn(
          'inline-flex items-center justify-center shrink-0 rounded-md font-bold uppercase select-none',
          className,
        )}
        style={{
          width: size,
          height: size,
          fontSize,
          color: style.color,
          backgroundColor: style.backgroundColor,
          border: `1px solid ${style.color}`,
        }}
        aria-hidden="true"
        title={name ?? undefined}
      >
        {initials}
      </span>
    );
  },
);
ProjectAvatar.displayName = 'ProjectAvatar';

export default ProjectAvatar;
