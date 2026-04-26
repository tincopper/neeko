import React from "react";
import { Separator } from "../ui";

interface EditorPanelProps {
  editorFontSize: number;
  onEditorFontSizeChange: (size: number) => void;
}

const EditorPanel: React.FC<EditorPanelProps> = ({
  editorFontSize,
  onEditorFontSizeChange,
}) => {
  return (
    <>
      <h3 className="text-base font-semibold text-text-primary mb-4">Editor</h3>
      <Separator className="mb-5" />
      <div className="flex items-center justify-between py-3 border-b border-white/[0.04] gap-6 [&:last-child]:border-b-0">
        <div className="flex-1 min-w-0">
          <div className="text-[0.86em] text-text-primary font-medium mb-0.75">
            Font Size
          </div>
          <div className="text-[0.79em] text-text-muted leading-relaxed">
            Font size for the file editor.
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            className="size-7 bg-bg-tertiary border border-border rounded text-text-primary text-[1.07em] cursor-pointer flex items-center justify-center transition-colors duration-150 hover:bg-bg-hover disabled:opacity-35 disabled:cursor-not-allowed"
            onClick={() => onEditorFontSizeChange(editorFontSize - 1)}
            disabled={editorFontSize <= 10}
          >
            &minus;
          </button>
          <span className="min-w-[44px] text-center text-[0.86em] text-text-primary tabular-nums">
            {editorFontSize}px
          </span>
          <button
            className="size-7 bg-bg-tertiary border border-border rounded text-text-primary text-[1.07em] cursor-pointer flex items-center justify-center transition-colors duration-150 hover:bg-bg-hover disabled:opacity-35 disabled:cursor-not-allowed"
            onClick={() => onEditorFontSizeChange(editorFontSize + 1)}
            disabled={editorFontSize >= 24}
          >
            +
          </button>
        </div>
      </div>
    </>
  );
};

export default React.memo(EditorPanel);
