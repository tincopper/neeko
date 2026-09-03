import React from 'react';

import { cn } from '@/lib/utils';

/**
 * Empty-state line for navigation lists ("No agents configured." …).
 */
const NavEmpty: React.FC<{ children: React.ReactNode; className?: string }> = ({
  children,
  className,
}) => {
  return (
    <p className={cn('px-2.5 py-1 text-[11px] text-text-muted leading-relaxed', className)}>
      {children}
    </p>
  );
};

NavEmpty.displayName = 'NavEmpty';

export default NavEmpty;
