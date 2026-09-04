import { useEditorStore } from '@/shared/store/editorStore';

/** 右簇：编辑器光标位置（无光标时隐藏）。 */
export function CursorItem() {
  const cursorPosition = useEditorStore((s) => s.cursorPosition);

  if (!cursorPosition) return null;

  return (
    <span>
      Ln {cursorPosition.line}, Col {cursorPosition.col}
    </span>
  );
}
