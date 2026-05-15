import React, { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { X } from "lucide-react";
import { Button, Badge } from "../ui";
import { ResizablePanel } from "../ui/resizable-panel";
import { MarkdownPreview } from "../ui/MarkdownPreview";
import type { ManagedSkillDto } from "../../types";
import { useAppConfig } from "../../hooks/useAppConfig";

interface ViewSkillDialogProps {
  open: boolean;
  skill: ManagedSkillDto | null;
  onClose: () => void;
}

interface SkillDocument {
  content: string;
}

const ViewSkillDialog: React.FC<ViewSkillDialogProps> = React.memo(
  ({ open, skill, onClose }) => {
    const { config } = useAppConfig();
    const [content, setContent] = useState("");
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
      if (open && skill) {
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

    const handleClose = useCallback(() => {
      setContent("");
      setError(null);
      onClose();
    }, [onClose]);

    if (!open || !skill) return null;

    return (
      <ResizablePanel open={open} onClose={handleClose}>
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-text-primary">
              {skill.name}
            </span>
            <Badge variant="default" className="text-[10px] px-1.5 py-0">
              {skill.source_type === "local" ? "����" : skill.source_type}
            </Badge>
          </div>
          <button
            onClick={handleClose}
            className="p-1 rounded hover:bg-bg-hover text-text-muted hover:text-text-primary"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Description and tags */}
        {(skill.description || skill.tags.length > 0) && (
          <div className="px-4 py-3 border-b border-border">
            {skill.description && (
              <p className="text-sm text-text-secondary mb-2">
                {skill.description}
              </p>
            )}
            {skill.tags.length > 0 && (
              <div className="flex gap-1 flex-wrap">
                {skill.tags.map((tag) => (
                  <Badge key={tag} variant="default" className="text-[10px] px-1.5 py-0">
                    {tag}
                  </Badge>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Content */}
        <div className="flex-1 min-h-0 overflow-y-auto">
          {loading ? (
            <div className="h-full flex items-center justify-center text-text-muted text-sm">
              Loading...
            </div>
          ) : error ? (
            <div className="h-full flex items-center justify-center text-red-400 text-sm p-4">
              {error}
            </div>
          ) : (
            <div className="p-4">
              <MarkdownPreview
                content={content}
                theme={config.theme}
                basePath={skill?.central_path}
              />
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-border">
          <Button variant="ghost" size="sm" onClick={handleClose} className="text-xs">
            Close
          </Button>
        </div>
      </ResizablePanel>
    );
  }
);

ViewSkillDialog.displayName = "ViewSkillDialog";

export default ViewSkillDialog;
