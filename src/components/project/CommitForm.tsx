import React, { useState, useRef } from "react";
import { Button } from "../ui/button";
import { GitCommitHorizontal, ArrowUp, Sparkles } from "lucide-react";

interface CommitFormProps {
  onCommit: (message: string) => void;
  onCommitAndPush: (message: string) => void;
  onAiGenerate?: () => void;
  loading: boolean;
  textareaHeight?: number;
}

const CommitForm: React.FC<CommitFormProps> = ({
  onCommit,
  onCommitAndPush,
  onAiGenerate,
  loading,
  textareaHeight,
}) => {
  const [message, setMessage] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

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
    <div className="px-2.5 py-2 shrink-0">
      <div className="relative">
        <textarea
          ref={textareaRef}
          className="w-full bg-bg-tertiary/60 border-0 rounded-md px-2.5 py-1.5 text-[var(--font-size)] text-text-primary placeholder:text-text-muted resize-none outline-none focus:ring-1 focus:ring-accent-blue/30 transition-all duration-100 font-mono"
          style={textareaHeight ? { height: textareaHeight, minHeight: textareaHeight } : { minHeight: 100 }}
          placeholder="Commit message (⌘+Enter to commit)"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={handleKeyDown}
        />
      </div>

      <div className="flex items-center gap-1.5 mt-1.5">
        <Button
          variant="primary"
          size="sm"
          className="text-[calc(var(--font-size)-1px)] gap-1"
          onClick={handleCommit}
          disabled={loading || !message.trim()}
        >
          <GitCommitHorizontal size={12} />
          Commit
        </Button>

        <Button
          variant="secondary"
          size="sm"
          className="text-[calc(var(--font-size)-1px)] gap-1"
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
            className="text-[calc(var(--font-size)-1px)] gap-1 ml-auto"
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
