import React, { useState, useCallback } from "react";
import { X } from "lucide-react";
import { Button, Input } from "../ui";
import MarkdownEditor from "./MarkdownEditor";

interface CreateSkillDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (name: string, skillContent: string) => Promise<void>;
}

function buildTemplate(name: string): string {
  const title = name.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  return [
    "---",
    `name: ${name}`,
    `description: ${title}`,
    "---",
    "",
    `# ${title}`,
    "",
    "Write your skill instructions here.",
    "",
  ].join("\n");
}

const CreateSkillDialog: React.FC<CreateSkillDialogProps> = React.memo(
  ({ open, onOpenChange, onConfirm }) => {
    const [name, setName] = useState("");
    const [content, setContent] = useState("");
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Reset state when dialog opens
    const handleNameChange = useCallback(
      (e: React.ChangeEvent<HTMLInputElement>) => {
        const newName = e.target.value;
        setName(newName);
        setError(null);
        if (!content || content === buildTemplate(name)) {
          setContent(buildTemplate(newName));
        }
      },
      [content, name]
    );

    const handleSubmit = useCallback(async () => {
      if (!name.trim()) {
        setError("Name is required");
        return;
      }
      if (!content.trim()) {
        setError("SKILL.md content is required");
        return;
      }
      try {
        setSubmitting(true);
        setError(null);
        await onConfirm(name.trim(), content);
        setName("");
        setContent("");
        onOpenChange(false);
      } catch (e) {
        setError(String(e));
      } finally {
        setSubmitting(false);
      }
    }, [name, content, onConfirm, onOpenChange]);

    const handleClose = useCallback(() => {
      setName("");
      setContent("");
      setError(null);
      onOpenChange(false);
    }, [onOpenChange]);

    if (!open) return null;

    return (
      <div className="fixed inset-0 z-50 flex">
        {/* Backdrop */}
        <div
          className="absolute inset-0 bg-black/50"
          onClick={handleClose}
        />

        {/* Slide-over panel */}
        <div className="relative ml-auto flex w-full max-w-2xl flex-col bg-bg-secondary border-l border-border shadow-xl">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-border">
            <span className="text-sm font-semibold text-text-primary">
              Create New Skill
            </span>
            <button
              onClick={handleClose}
              className="p-1 rounded hover:bg-bg-hover text-text-muted hover:text-text-primary"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Name input */}
          <div className="px-4 py-3 border-b border-border">
            <label className="text-xs font-medium text-text-secondary block mb-1.5">
              Skill Name
            </label>
            <Input
              value={name}
              onChange={handleNameChange}
              placeholder="my-skill"
              className="h-8 text-xs"
              autoFocus
            />
            <p className="text-[10px] text-text-muted mt-1">
              SKILL.md will be saved to ~/.neeko/skills/{name || "{name}"}/
            </p>
          </div>

          {/* Markdown editor */}
          <div className="flex-1 min-h-0 flex flex-col">
            <div className="px-4 py-2 border-b border-border">
              <label className="text-xs font-medium text-text-secondary">
                SKILL.md
              </label>
            </div>
            <div className="flex-1 min-h-0">
              <MarkdownEditor
                value={content}
                onChange={setContent}
                placeholder="Write your skill content in markdown..."
                className="h-full [&_.cm-editor]:h-full"
              />
            </div>
          </div>

          {/* Error + footer */}
          {error && (
            <div className="px-4 py-2 border-t border-border">
              <p className="text-xs text-red-400">{error}</p>
            </div>
          )}
          <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-border">
            <Button
              variant="ghost"
              size="sm"
              onClick={handleClose}
              className="text-xs"
            >
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={handleSubmit}
              disabled={submitting || !name.trim() || !content.trim()}
              className="text-xs"
            >
              {submitting ? "Creating..." : "Create"}
            </Button>
          </div>
        </div>
      </div>
    );
  }
);
CreateSkillDialog.displayName = "CreateSkillDialog";
export default CreateSkillDialog;
