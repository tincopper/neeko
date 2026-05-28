import React, { useRef } from "react";
import { Button } from "../ui/button";
import { GitCommitHorizontal, ArrowUp, Sparkles, Loader2 } from "@/components/icons"

interface CommitFormProps {
  /** 受控 message 值 */
  message: string;
  onMessageChange: (value: string) => void;
  onCommit: (message: string) => void;
  onCommitAndPush: (message: string) => void;
  /** 提供时显示 AI 按钮；undefined 表示不支持，显示禁用态 */
  onAiGenerate?: () => void;
  /** AI 是否支持（项目有合法 agent），false 时显示禁用按钮 + tooltip */
  canAiGenerate?: boolean;
  /** AI 生成中 */
  aiGenerating?: boolean;
  loading: boolean;
  textareaHeight?: number;
}

const CommitForm: React.FC<CommitFormProps> = ({
  message,
  onMessageChange,
  onCommit,
  onCommitAndPush,
  onAiGenerate,
  canAiGenerate = false,
  aiGenerating = false,
  loading,
  textareaHeight,
}) => {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      if (message.trim()) {
        onCommit(message.trim());
      }
    }
  };

  const handleCommit = () => {
    if (message.trim()) {
      onCommit(message.trim());
    }
  };

  const handleCommitPush = () => {
    if (message.trim()) {
      onCommitAndPush(message.trim());
    }
  };

  const aiDisabled = loading || aiGenerating || !canAiGenerate;
  const aiTooltip = !canAiGenerate
    ? "Please select an Agent for the project first (right-click project > Select Agent)"
    : undefined;

  return (
    <div className="px-2.5 py-2 shrink-0">
      <div className="relative">
        <textarea
          ref={textareaRef}
          className="w-full bg-bg-tertiary/60 border-0 rounded-md px-2.5 py-1.5 text-[var(--font-size)] text-text-primary placeholder:text-text-muted resize-none outline-none focus:ring-1 focus:ring-accent-blue/30 transition-all duration-100 font-mono"
          style={textareaHeight ? { height: textareaHeight, minHeight: textareaHeight } : { minHeight: 100 }}
          placeholder={aiGenerating ? "AI is generating commit message..." : "Commit message (⌘+Enter to commit)"}
          value={message}
          onChange={(e) => onMessageChange(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={aiGenerating}
        />
      </div>

      <div className="flex items-center gap-1.5 mt-1.5">
        <Button
          variant="primary"
          size="sm"
          className="text-[calc(var(--font-size)-1px)] gap-1"
          onClick={handleCommit}
          disabled={loading || aiGenerating || !message.trim()}
        >
          <GitCommitHorizontal size={12} />
          Commit
        </Button>

        <Button
          variant="secondary"
          size="sm"
          className="text-[calc(var(--font-size)-1px)] gap-1"
          onClick={handleCommitPush}
          disabled={loading || aiGenerating || !message.trim()}
        >
          <ArrowUp size={12} />
          Commit & Push
        </Button>

        <Button
          variant="ghost"
          size="sm"
          className="text-[calc(var(--font-size)-1px)] gap-1 ml-auto"
          onClick={onAiGenerate}
          disabled={aiDisabled}
          title={aiTooltip}
        >
          {aiGenerating ? (
            <Loader2 size={12} className="animate-spin" />
          ) : (
            <Sparkles size={12} />
          )}
          AI
        </Button>
      </div>
    </div>
  );
};

export default React.memo(CommitForm);
