import type { LucideIcon } from 'lucide-react';
import React, { useCallback } from 'react';

import { FolderPlus, Server, Terminal } from '@/shared/components/icons';
import { IS_WINDOWS } from '@/shared/utils/platform';

interface AddProjectMenuProps {
  onClose: () => void;
  onAddProject: () => void;
  onAddWsl: () => void;
  onAddRemote: () => void;
}

interface AddProjectMenuItemProps {
  label: string;
  onClick: () => void;
  icon: LucideIcon;
}

function AddProjectMenuItem({ label, onClick, icon: Icon }: AddProjectMenuItemProps) {
  return (
    <button
      type="button"
      className="group flex w-full items-center rounded-sm px-2.5 py-1.5 text-left text-[var(--font-size)] leading-5 text-text-primary transition-colors hover:bg-bg-hover focus-visible:bg-bg-hover focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent-blue"
      onClick={onClick}
    >
      <Icon
        size={16}
        strokeWidth={1.8}
        className="mr-2 shrink-0 text-text-secondary transition-colors group-hover:text-text-primary"
        aria-hidden="true"
      />
      <span>{label}</span>
    </button>
  );
}

const AddProjectMenu: React.FC<AddProjectMenuProps> = React.memo(
  ({ onClose, onAddProject, onAddWsl, onAddRemote }) => {
    const select = useCallback(
      (action: () => void) => {
        onClose();
        action();
      },
      [onClose],
    );

    return (
      <div className="absolute bottom-0 left-[calc(100%+8px)] z-50 w-52 rounded-md border border-border bg-bg-tertiary p-1 shadow-xl">
        <AddProjectMenuItem
          label="Add Local Project"
          icon={FolderPlus}
          onClick={() => select(onAddProject)}
        />
        {IS_WINDOWS && (
          <AddProjectMenuItem
            label="Add WSL Distro"
            icon={Terminal}
            onClick={() => select(onAddWsl)}
          />
        )}
        <AddProjectMenuItem
          label="Add Remote Server"
          icon={Server}
          onClick={() => select(onAddRemote)}
        />
      </div>
    );
  },
);

AddProjectMenu.displayName = 'AddProjectMenu';

export default AddProjectMenu;
