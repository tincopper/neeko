import { useCallback, useRef, useState } from 'react';

import type { AgentConfig } from '@/shared/types';

interface UseAgentMenuOptions {
  onSelectAgent?: (agent: AgentConfig) => void;
}

interface UseAgentMenuReturn {
  open: boolean;
  anchorRef: React.RefObject<HTMLButtonElement>;
  handleOpen: () => void;
  handleClose: () => void;
  handleSelect: (agent: AgentConfig) => void;
}

export function useAgentMenu({ onSelectAgent }: UseAgentMenuOptions): UseAgentMenuReturn {
  const [open, setOpen] = useState(false);
  // null! is safe here: the ref is only accessed after the component mounts
  // and React guarantees the ref is set before any effects run
  const anchorRef = useRef<HTMLButtonElement>(null!);

  const handleOpen = useCallback(() => setOpen(true), []);
  const handleClose = useCallback(() => setOpen(false), []);

  const handleSelect = useCallback(
    (agent: AgentConfig) => {
      onSelectAgent?.(agent);
    },
    [onSelectAgent],
  );

  return {
    open,
    anchorRef,
    handleOpen,
    handleClose,
    handleSelect,
  };
}
