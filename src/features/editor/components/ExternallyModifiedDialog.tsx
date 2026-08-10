import React from 'react';

interface ExternallyModifiedDialogProps {
  fileName: string;
  onKeepEdits: () => void;
  onReload: () => void;
}

/**
 * 外部文件修改确认对话框：重新加载或保留当前编辑。
 */
function ExternallyModifiedDialog({
  fileName,
  onKeepEdits,
  onReload,
}: ExternallyModifiedDialogProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-bg-primary border border-border rounded-lg shadow-xl p-6 w-[420px] max-w-[90vw] overflow-hidden">
        <h3 className="text-sm font-semibold text-text-primary mb-2">文件已在外部修改</h3>
        <p className="text-sm text-text-secondary mb-1">
          <span className="font-medium text-text-primary">{fileName}</span> 已被外部程序修改。
        </p>
        <p className="text-sm text-text-secondary mb-5">是否重新加载？你当前的编辑将会丢失。</p>
        <div className="flex justify-end gap-2">
          <button
            className="px-3 py-1.5 text-sm rounded border border-border text-text-secondary hover:bg-bg-hover transition-colors"
            onClick={onKeepEdits}
          >
            保留当前编辑
          </button>
          <button
            className="px-3 py-1.5 text-sm rounded bg-accent text-white hover:bg-accent/90 transition-colors"
            onClick={onReload}
          >
            重新加载
          </button>
        </div>
      </div>
    </div>
  );
}

export default React.memo(ExternallyModifiedDialog);
