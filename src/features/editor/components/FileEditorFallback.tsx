import type { FileTab } from '@/shared/types';

import EditorHeader from './EditorHeader';
import ImageFileView from './ImageFileView';
import UneditableFileView from './UneditableFileView';

/** 只读兜底视图类型；`null` = 正常可编辑。 */
export type FileEditorFallbackKind = 'image' | 'binary' | 'oversized';

/** 判定落到哪个兜底视图（顺序固定：二进制优先，其次超大文件）。 */
export function fileEditorFallbackKind(
  tab: FileTab,
  isBinaryImage: boolean,
): FileEditorFallbackKind | null {
  if (tab.content.is_binary) return isBinaryImage ? 'image' : 'binary';
  if (tab.content.size > 512 * 1024) return 'oversized';
  return null;
}

interface Props {
  kind: FileEditorFallbackKind;
  tab: FileTab;
  projectPath: string | null;
  absFilePath: string;
}

/** 二进制（本地图片走预览）/ 超大文件的只读兜底视图。 */
export default function FileEditorFallback({ kind, tab, projectPath, absFilePath }: Props) {
  if (kind === 'image') {
    return (
      <div className="flex-1 flex flex-col">
        <EditorHeader
          filePath={tab.filePath}
          projectPath={projectPath}
          isDirty={false}
          isMd={false}
          isHtml={false}
          isSvg={false}
          isJson={false}
          previewMode="preview"
          onTogglePreview={() => {}}
        />
        <ImageFileView absPath={absFilePath} fileName={tab.fileName} />
      </div>
    );
  }
  return (
    <UneditableFileView
      filePath={tab.filePath}
      projectPath={projectPath}
      size={tab.content.size}
      message={
        kind === 'binary'
          ? 'Binary file — cannot be displayed'
          : 'File too large to edit (> 500 KB)'
      }
    />
  );
}
