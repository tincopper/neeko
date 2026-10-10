/**
 * 用户级文件监听排除编辑区（D2 / VS Code `files.watcherExclude` 式）。
 *
 * 每行一个 gitignore 方言 glob（相对项目根，支持 `**`），空行忽略。文本立即解析回
 * `string[]` 经 `onExcludesChange` 向上传递（宿主容器持久化：`EditorPanel` →
 * `EditorSettingsPanel` → `SettingsPanel`/`SettingsView` 的 `onConfigChange`）；
 * 外部值变化（如配置加载完成）时仅在真正的外部变更下回灌，避免打字过程中被重置。
 */

import React, { useState } from 'react';

import { Textarea } from '@/ui';

interface WatcherExcludeSectionProps {
  excludes: string[];
  onExcludesChange: (patterns: string[]) => void;
}

/** 模式数组 → 编辑区文本（每行一个）。 */
function serialize(patterns: string[]): string {
  return patterns.join('\n');
}

/** 编辑区文本 → 模式数组（去空白行，保留原始缩进内容）。 */
function parse(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

const WatcherExcludeSection: React.FC<WatcherExcludeSectionProps> = ({
  excludes,
  onExcludesChange,
}) => {
  const [text, setText] = useState(() => serialize(excludes));
  // 最近一次由本编辑区发出的模式：父级回传的就是它时视为「自己的回声」，
  // 不重置本地文本（否则会剥掉打字过程中的尾部换行）；只有真正的
  // 外部变更（配置加载 / 其他入口）才回灌。
  const [lastEmitted, setLastEmitted] = useState(() => serialize(excludes));

  const incoming = serialize(excludes);
  if (incoming !== lastEmitted) {
    setLastEmitted(incoming);
    setText(incoming);
  }

  const handleChange = (value: string) => {
    setText(value);
    const patterns = parse(value);
    setLastEmitted(serialize(patterns));
    onExcludesChange(patterns);
  };

  return (
    <div className="flex flex-col gap-2 py-3 border-b border-white/[0.04]">
      <div className="text-[0.86em] text-text-primary font-medium">Watcher Exclusions</div>
      <div className="text-[0.79em] text-text-muted leading-relaxed">
        One glob per line, relative to the project root (gitignore syntax, <code>**</code>{' '}
        supported). Files under matching folders are not watched — useful for large build output.
        Empty = follow <code>.gitignore</code> only.
      </div>
      <Textarea
        aria-label="Watcher exclude patterns"
        placeholder={'target/\n**/node_modules/**'}
        value={text}
        rows={4}
        spellCheck={false}
        onChange={(e) => handleChange(e.target.value)}
      />
    </div>
  );
};

export default React.memo(WatcherExcludeSection);
