import React, { useState, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "../ui/dialog";
import { Button, Input } from "../ui";

interface CreateSkillDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (name: string, description?: string) => Promise<void>;
}

const CreateSkillDialog: React.FC<CreateSkillDialogProps> = React.memo(
  ({ open, onOpenChange, onConfirm }) => {
    const [name, setName] = useState("");
    const [description, setDescription] = useState("");
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleSubmit = useCallback(async () => {
      if (!name.trim()) {
        setError("Name is required");
        return;
      }
      try {
        setSubmitting(true);
        setError(null);
        await onConfirm(name.trim(), description.trim() || undefined);
        setName("");
        setDescription("");
        onOpenChange(false);
      } catch (e) {
        setError(String(e));
      } finally {
        setSubmitting(false);
      }
    }, [name, description, onConfirm, onOpenChange]);

    const handleKeyDown = useCallback(
      (e: React.KeyboardEvent) => {
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          handleSubmit();
        }
      },
      [handleSubmit]
    );

    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-[400px] bg-bg-secondary border-border">
          <DialogHeader>
            <DialogTitle className="text-text-primary">Create New Skill</DialogTitle>
            <DialogDescription className="text-text-muted">
              Create a new skill with a SKILL.md template in the central repository.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3 py-2">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-text-secondary">Name</label>
              <Input
                value={name}
                onChange={(e) => { setName(e.target.value); setError(null); }}
                onKeyDown={handleKeyDown}
                placeholder="my-skill"
                className="h-8 text-xs"
                autoFocus
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-text-secondary">Description</label>
              <Input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Optional description"
                className="h-8 text-xs"
              />
            </div>
            {error && (
              <p className="text-xs text-red-400">{error}</p>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onOpenChange(false)}
              className="text-xs"
            >
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={handleSubmit}
              disabled={submitting || !name.trim()}
              className="text-xs"
            >
              {submitting ? "Creating..." : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }
);
CreateSkillDialog.displayName = "CreateSkillDialog";
export default CreateSkillDialog;
