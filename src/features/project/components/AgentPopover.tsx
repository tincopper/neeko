import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import AgentIcon from '@/shared/components/AgentIcon';
import type { AgentConfig } from '@/shared/types';
import { getPopoverPosition } from '@/shared/utils/popoverPosition';

interface AgentPopoverProps {
  open: boolean;
  anchorRef: React.RefObject<HTMLButtonElement>;
  agents: AgentConfig[];
  selectedAgentId: string | null;
  installedMap: Map<string, boolean>;
  onSelect: (agent: AgentConfig) => void;
  onClose: () => void;
  width?: number;
  maxHeight?: number;
}

const DEFAULT_WIDTH = 240;
const DEFAULT_MAX_HEIGHT = 280;

export function AgentPopover({
  open,
  anchorRef,
  agents,
  selectedAgentId,
  installedMap,
  onSelect,
  onClose,
  width = DEFAULT_WIDTH,
  maxHeight = DEFAULT_MAX_HEIGHT,
}: AgentPopoverProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number; openUp: boolean } | null>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (
        ref.current &&
        !ref.current.contains(e.target as Node) &&
        anchorRef.current &&
        !anchorRef.current.contains(e.target as Node)
      ) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open, onClose, anchorRef]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onClose]);

  useEffect(() => {
    if (!open || !anchorRef.current) return;

    const update = () => {
      if (anchorRef.current) {
        setPos(getPopoverPosition(anchorRef.current, width, maxHeight));
      }
    };
    update();

    window.addEventListener('scroll', update, true);
    window.addEventListener('resize', update);
    return () => {
      window.removeEventListener('scroll', update, true);
      window.removeEventListener('resize', update);
    };
  }, [open, anchorRef, width, maxHeight]);

  const sortedAgents = useMemo(
    () =>
      [...agents]
        .filter((a) => a.enabled)
        .sort((a, b) => {
          if (selectedAgentId) {
            if (a.id === selectedAgentId) return -1;
            if (b.id === selectedAgentId) return 1;
          }
          const aInstalled = installedMap.size === 0 || (installedMap.get(a.id) ?? true);
          const bInstalled = installedMap.size === 0 || (installedMap.get(b.id) ?? true);
          if (aInstalled === bInstalled) return 0;
          return aInstalled ? -1 : 1;
        }),
    [agents, installedMap, selectedAgentId],
  );

  if (!open || !pos) return null;

  const transformOrigin = pos.openUp ? 'bottom left' : 'top left';

  return createPortal(
    <div
      ref={ref}
      className="agent-popover"
      role="menu"
      style={{
        left: pos.left,
        top: pos.top,
        width,
        maxHeight,
        transformOrigin,
      }}
    >
      {sortedAgents.map((agent) => {
        const installed = installedMap.size === 0 || (installedMap.get(agent.id) ?? true);
        const isSelected = selectedAgentId === agent.id;
        const itemClasses = [
          'agent-popover-item',
          isSelected && 'selected',
          !installed && 'not-installed',
        ]
          .filter(Boolean)
          .join(' ');
        return (
          <button
            key={agent.id}
            type="button"
            className={itemClasses}
            role="menuitem"
            disabled={!installed || !agent.enabled}
            onClick={() => {
              if (installed && agent.enabled) {
                onSelect(agent);
                onClose();
              }
            }}
          >
            <AgentIcon icon={agent.icon} size={16} />
            <span className="agent-popover-item-name">{agent.name}</span>
            {isSelected && <span className="agent-popover-item-badge">Default</span>}
            {!installed && <span className="agent-popover-item-badge error">Not installed</span>}
          </button>
        );
      })}
    </div>,
    document.body,
  );
}
