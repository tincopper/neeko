import { useEffect, useRef } from 'react';

import { fileIconSrc } from '@/shared/utils/fileIcons';

interface InlineNameInputProps {
  kind: 'file' | 'dir';
  value?: string;
  onChange?: (value: string) => void;
  onSubmit?: () => void;
  onCancel?: () => void;
  indent: number;
  /** 挂载时全选文本（重命名场景） */
  selectOnMount?: boolean;
  /** 失焦时提交（重命名场景） */
  commitOnBlur?: boolean;
}

/** 新建/重命名的内联名称输入行 */
function InlineNameInput({
  kind,
  value = '',
  onChange,
  onSubmit,
  onCancel,
  indent,
  selectOnMount = false,
  commitOnBlur = false,
}: InlineNameInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    if (selectOnMount) {
      inputRef.current?.select();
    }
  }, [selectOnMount]);

  return (
    <div className="flex items-center gap-1 py-0.5 pr-2" style={{ paddingLeft: indent }}>
      {/* 与节点行对齐：目录行有 chevron，文件行有同宽占位符 */}
      <span className="w-3.5 h-3.5 shrink-0" />
      {kind === 'dir' ? (
        <img
          className="w-4 h-4 shrink-0 block"
          src="/icons/_folder.svg"
          alt=""
          width={16}
          height={16}
        />
      ) : (
        <img
          className="w-3.5 h-3.5 shrink-0 block"
          src={fileIconSrc(value || 'file.txt')}
          alt=""
          width={14}
          height={14}
        />
      )}
      <input
        ref={inputRef}
        value={value}
        onChange={(e) => onChange?.(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            onSubmit?.();
          } else if (e.key === 'Escape') {
            e.preventDefault();
            onCancel?.();
          }
        }}
        onBlur={() => {
          if (!value.trim()) {
            onCancel?.();
          } else if (commitOnBlur) {
            onSubmit?.();
          }
        }}
        placeholder={kind === 'file' ? 'filename' : 'folder name'}
        className="flex-1 min-w-0 px-1.5 py-0.5 rounded border border-accent-blue bg-bg-primary text-text-primary placeholder:text-text-muted outline-none text-[var(--font-size)]"
      />
    </div>
  );
}

export default InlineNameInput;
