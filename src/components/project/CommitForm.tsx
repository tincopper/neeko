import React, { useState, useRef, useEffect } from "react";
import { Button } from "../ui/button";
import { GitCommitHorizontal, ArrowUp, Sparkles } from "lucide-react";

interface CommitFormProps {
  onCommit: (message: string) => void;
  onCommitAndPush: (message: string) => void;
  onAiGenerate?: () => void;
  loading: boolean;
}

const CommitForm: React.FC<CommitFormProps> = ({
  onCommit,
  onCommitAndPush,
  onAiGenerate,
  loading,
}) => {
  const [message, setMessage] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const adjustHeight = () => {
    const el = textareaRef.current;
    if (el) {
      el.style.height = "auto";
      el.style.height = `${el.scrollHeight}px`;
    }
  };

  useEffect(() => {
    adjustHeight();
  }, [message]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      if (message.trim()) {
        onCommit(message.trim());
        setMessage("");
      }
    }
  };

  const handleCommit = () => {
    if (message.trim()) {
      onCommit(message.trim());
      setMessage("");
    }
  };

  const handleCommitPush = () => {
    if (message.trim()) {
      onCommitAndPush(message.trim());
      setMessage("");
    }
  };

  return (
    <div className="px-3 py-2 border-b border-border shrink-0">
      <div className="relative">
        <textarea
          ref={textareaRef}
          className="w-full bg-bg-tertiary border border-border rounded-md px-2.5 py-1.5 text-xs text-text-primary placeholder:text-text-muted resize-none outline-none focus:border-accent-blue/50 transition-colors duration-100 font-mono min-h-[50px]"
          placeholder="Commit message (⌘+Enter to commit)"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={handleKeyDown}
          rows={3}
        />
      </div>

      <div className="flex items-center gap-1.5 mt-2">
        <Button
          variant="primary"
          size="sm"
          className="text-[11px] gap-1"
          onClick={handleCommit}
          disabled={loading || !message.trim()}
        >
          <GitCommitHorizontal size={12} />
          Commit
        </Button>

        <Button
          variant="secondary"
          size="sm"
          className="text-[11px] gap-1"
          onClick={handleCommitPush}
          disabled={loading || !message.trim()}
        >
          <ArrowUp size={12} />
          Commit & Push
        </Button>

        {onAiGenerate && (
          <Button
            variant="ghost"
            size="sm"
            className="text-[11px] gap-1 ml-auto"
            onClick={onAiGenerate}
            disabled={loading}
          >
            <Sparkles size={12} />
            AI
          </Button>
        )}
      </div>
    </div>
  );
};

export default React.memo(CommitForm);
