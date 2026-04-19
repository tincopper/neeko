import React, { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { X } from "lucide-react";
import { Button, Input } from "../ui";
import MarkdownEditor from "./MarkdownEditor";
import type { ManagedSkillDto } from "../../types";

interface EditSkillDialogProps {
  open: boolean;
  skill: ManagedSkillDto | null;
  onClose: () => void;
  onConfirm: (name: string, skillContent: string) => Promise<void>;
}

interface SkillDocument {
  content: string;
}

const EditSkillDialog: React.FC<EditSkillDialogProps> = React.memo(
  ({ open, skill, onClose, onConfirm }) => {
    const [name, setName] = useState("");
    const [content, setContent] = useState("");
    const [loading, setLoading] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Load skill content when dialog opens
    useEffect(() => {
      if (open && skill) {
        setName(skill.name);
        setLoading(true);
        setError(null);
        
        invoke<SkillDocument>("get_skill_document", { skillId: skill.id })
          .then((doc) => {
            setContent(doc.content);
          })
          .catch((e) => {
            setError(String(e));
          })
          .finally(() => {
            setLoading(false);
          });
      }
    }, [open, skill]);

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
        onClose();
      } catch (e) {
        setError(String(e));
      } finally {
        setSubmitting(false);
      }
    }, [name, content, onConfirm, onClose]);

    const handleClose = useCallback(() => {
      setName("");
      setContent("");
      setError(null);
      onClose();
    }, [onClose]);

    if (!open) return null;

    return (
      <div className="fixed inset-0 z-50 flex">
        {/* Backdrop */}
        <div className="absolute inset-0 bg-black/50" onClick={handleClose} />

        {/* Slide-over panel */}
        <div className="relative ml-auto flex w-full max-w-2xl flex-col bg-bg-secondary border-l border-border shadow-xl">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-border">
            <span className="text-sm font-semibold text-text-primary">
              Edit Skill
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
              onChange={(e) => setName(e.target.value)}
              placeholder="my-skill"
              className="h-8 text-xs"
              disabled={loading}
            />
          </div>

          {/* Markdown editor */}
          <div className="flex-1 min-h-0 flex flex-col">
            <div className="px-4 py-2 border-b border-border">
              <label className="text-xs font-medium text-text-secondary">
                SKILL.md
              </label>
              {loading && <span className="text-xs text-text-muted ml-2">Loading...</span>}
            </div>
            <div className="flex-1 min-h-0">
              {loading ? (
                <div className="h-full flex items-center justify-center text-text-muted text-sm">
                  Loading...
                </div>
              ) : (
                <MarkdownEditor
                  value={content}
                  onChange={setContent}
                  placeholder="Write your skill content in markdown..."
                  className="h-full [&_.cm-editor]:h-full"
                />
              )}
            </div>
          </div>

          {/* Error + footer */}
          {error && (
            <div className="px-4 py-2 border-t border-border">
              <p className="text-xs text-red-400">{error}</p>
            </div>
          )}
          <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-border">
            <Button variant="ghost" size="sm" onClick={handleClose} className="text-xs">
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={handleSubmit}
              disabled={submitting || loading || !name.trim() || !content.trim()}
              className="text-xs"
            >
              {submitting ? "Saving..." : "Save"}
            </Button>
          </div>
        </div>
      </div>
    );
  }
);

EditSkillDialog.displayName = "EditSkillDialog";

export default EditSkillDialog;
