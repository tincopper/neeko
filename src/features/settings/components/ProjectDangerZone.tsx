/** 危险区：移除项目（自持二次确认状态；仅通知父级执行移除）。 */

import { useState } from 'react';

import { Button } from '@/ui';

interface Props {
  onRemove: () => void;
}

export default function ProjectDangerZone({ onRemove }: Props) {
  const [confirmRemove, setConfirmRemove] = useState(false);
  return (
    <div className="mt-6 pt-6 border-t border-border">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-[0.86em] text-text-primary font-medium">Remove project</div>
          <div className="text-[0.79em] text-text-muted">
            Remove from Neeko. Local files stay intact.
          </div>
        </div>
        {confirmRemove ? (
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setConfirmRemove(false)}>
              Cancel
            </Button>
            <Button variant="destructive" size="sm" onClick={onRemove}>
              Confirm
            </Button>
          </div>
        ) : (
          <Button variant="destructive" size="sm" onClick={() => setConfirmRemove(true)}>
            Remove
          </Button>
        )}
      </div>
    </div>
  );
}
