import { X } from 'lucide-react';
import React, { useCallback, useEffect, useMemo, useState } from 'react';

import { useLibraryStore } from '@/features/library/store/libraryStore';
import { cn } from '@/lib/utils';
import { useProjectStore } from '@/shared/store/projectStore';
import { Button } from '@/ui/Button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/ui/Dialog';

interface VariableDialogProps {
  /** The raw prompt content containing `{{variable}}` placeholders. */
  content: string;
  /** Called with the rendered content when the user confirms. */
  onConfirm: (rendered: string) => void;
  /** Called when the user cancels. */
  onCancel: () => void;
}

const VariableDialog: React.FC<VariableDialogProps> = React.memo(
  ({ content, onConfirm, onCancel }) => {
    const detectVariables = useLibraryStore((s) => s.detectVariables);
    const resolveVariables = useLibraryStore((s) => s.resolveVariables);
    const activeProject = useProjectStore((s) => s.activeProject);

    const variables = useMemo(() => detectVariables(content), [content, detectVariables]);

    const [values, setValues] = useState<Record<string, string>>({});

    // Auto-fill known variables from project context.
    useEffect(() => {
      const initial: Record<string, string> = {};
      for (const v of variables) {
        if (v === 'projectName') {
          initial[v] = activeProject?.name ?? '';
        } else if (v === 'projectPath') {
          initial[v] = activeProject?.path ?? '';
        } else if (v === 'branch') {
          initial[v] = activeProject?.git_info?.current_branch ?? '';
        }
      }
      setValues(initial);
    }, [variables, activeProject]);

    const handleChange = useCallback((name: string, value: string) => {
      setValues((prev) => ({ ...prev, [name]: value }));
    }, []);

    const handleConfirm = useCallback(() => {
      const rendered = resolveVariables(content, values);
      onConfirm(rendered);
    }, [content, values, resolveVariables, onConfirm]);

    return (
      <Dialog open onOpenChange={(v) => !v && onCancel()}>
        <DialogContent className="max-w-[520px] p-0 gap-0 overflow-hidden">
          <DialogHeader className="px-4 py-3 border-b border-border">
            <DialogTitle className="text-sm font-semibold">Fill Variables</DialogTitle>
            <button
              type="button"
              className="absolute right-3 top-3 p-1 rounded text-text-muted hover:text-text-primary hover:bg-bg-hover"
              onClick={onCancel}
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </button>
          </DialogHeader>

          <div className="px-4 py-3 space-y-3 max-h-[50vh] overflow-y-auto">
            {variables.length === 0 ? (
              <p className="text-[var(--font-size)] text-text-secondary">No variables detected.</p>
            ) : (
              variables.map((v) => (
                <div key={v}>
                  <label
                    htmlFor={`var-${v}`}
                    className="block text-[11px] font-medium text-text-muted mb-1"
                  >
                    {v}
                  </label>
                  <input
                    id={`var-${v}`}
                    className={cn(
                      'w-full h-8 px-2.5 text-[var(--font-size)] rounded-md',
                      'bg-bg-primary border border-border text-text-primary',
                      'outline-none focus:border-accent-blue placeholder:text-text-muted',
                    )}
                    placeholder={`Enter ${v}`}
                    value={values[v] ?? ''}
                    onChange={(e) => handleChange(v, e.target.value)}
                  />
                </div>
              ))
            )}
          </div>

          <div className="px-4 py-3 border-t border-border flex justify-end gap-2">
            <Button variant="secondary" size="sm" onClick={onCancel}>
              Cancel
            </Button>
            <Button variant="primary" size="sm" onClick={() => void handleConfirm()}>
              Insert
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    );
  },
);

VariableDialog.displayName = 'VariableDialog';

export default VariableDialog;
