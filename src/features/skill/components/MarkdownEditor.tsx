import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete';
import { defaultKeymap } from '@codemirror/commands';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { foldGutter, indentOnInput, bracketMatching } from '@codemirror/language';
import {
  lineNumbers,
  highlightActiveLine,
  highlightActiveLineGutter,
  drawSelection,
  keymap,
} from '@codemirror/view';
import CodeMirror from '@uiw/react-codemirror';
import React, { useCallback, useMemo } from 'react';

import { useAppContext } from '@/shared/contexts';
import { createCmTheme } from '@/shared/utils/codemirror';
import { imeSpaceGuard } from '@/shared/utils/codemirrorIme';

interface MarkdownEditorProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}

const MarkdownEditor: React.FC<MarkdownEditorProps> = React.memo(
  ({ value, onChange, placeholder, className }) => {
    const { config } = useAppContext();

    const handleChange = useCallback((val: string) => onChange(val), [onChange]);

    const cmTheme = useMemo(
      () => createCmTheme(config.fontFamily, config.editorFontSize),
      [config.fontFamily, config.editorFontSize],
    );

    const extensions = useMemo(() => {
      const exts: import('@codemirror/state').Extension[] = [
        markdown({ base: markdownLanguage }),
        lineNumbers(),
        highlightActiveLine(),
        highlightActiveLineGutter(),
        foldGutter(),
        bracketMatching(),
        closeBrackets(),
        indentOnInput(),
        drawSelection(),
        keymap.of([...closeBracketsKeymap, ...defaultKeymap]),
        imeSpaceGuard(),
        cmTheme,
      ];

      return exts;
    }, [cmTheme]);

    return (
      <CodeMirror
        value={value}
        onChange={handleChange}
        extensions={extensions}
        placeholder={placeholder}
        className={className}
        theme={cmTheme}
        basicSetup={false}
      />
    );
  },
);
MarkdownEditor.displayName = 'MarkdownEditor';
export default MarkdownEditor;
