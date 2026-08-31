import React from 'react';

import { resolveEditorFontSize } from '@/shared/utils/typography';
import { Separator, Switch } from '@/ui';

interface EditorPanelProps {
  editorFontSize: number;
  onEditorFontSizeChange: (size: number) => void;
  /** 和谐默认值：默认 = terminal 字号，用于恢复按钮 */
  harmonyEditorSize?: number;
  /** 切换 file tab 时自动在文件树中定位该文件 */
  autoLocateFileOnTabSwitch: boolean;
  onAutoLocateFileOnTabSwitchChange: (enabled: boolean) => void;
}

const EditorPanel: React.FC<EditorPanelProps> = ({
  editorFontSize,
  onEditorFontSizeChange,
  autoLocateFileOnTabSwitch,
  onAutoLocateFileOnTabSwitchChange,
  harmonyEditorSize,
}) => {
  const harmonySize = harmonyEditorSize ?? resolveEditorFontSize(14, null);
  return (
    <>
      <h3 className="text-base font-semibold text-text-primary mb-4">Editor</h3>
      <Separator className="mb-5" />
      <div className="flex items-center justify-between py-3 border-b border-white/[0.04] gap-6 [&:last-child]:border-b-0">
        <div className="flex-1 min-w-0">
          <div className="text-[0.86em] text-text-primary font-medium mb-0.75">Font Size</div>
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
          {editorFontSize !== harmonySize && (
            <button
              className="ml-1 text-[0.72em] text-accent-blue hover:text-accent-blue/80 underline underline-offset-2"
              onClick={() => onEditorFontSizeChange(harmonySize)}
              title={`恢复和谐默认 ${harmonySize}px (跟随终端)`}
            >
              恢复和谐默认 ({harmonySize}px)
            </button>
          )}
        </div>
      </div>
      <div className="flex items-center justify-between py-3 border-b border-white/[0.04] gap-6 [&:last-child]:border-b-0">
        <div className="flex-1 min-w-0">
          <div className="text-[0.86em] text-text-primary font-medium mb-0.75">
            Auto-locate file on tab switch
          </div>
          <div className="text-[0.79em] text-text-muted leading-relaxed">
            When switching file tabs, automatically reveal the file in the file tree.
          </div>
        </div>
        <Switch
          checked={autoLocateFileOnTabSwitch}
          onCheckedChange={onAutoLocateFileOnTabSwitchChange}
        />
      </div>
    </>
  );
};

export default React.memo(EditorPanel);
