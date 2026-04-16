import React, { useCallback, useMemo } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { markdown } from "@codemirror/lang-markdown";
import { lineNumbers, highlightActiveLine, highlightActiveLineGutter, drawSelection, keymap } from "@codemirror/view";
import { defaultKeymap } from "@codemirror/commands";
import { foldGutter, indentOnInput, syntaxHighlighting, defaultHighlightStyle, bracketMatching } from "@codemirror/language";
import { closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete";
import { oneDark } from "@codemirror/theme-one-dark";
import { getCmFontStyle } from "../../utils/codemirror";
import { useAppContext } from "../../context/app-context";

interface MarkdownEditorProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}

const MarkdownEditor: React.FC<MarkdownEditorProps> = React.memo(
  ({ value, onChange, placeholder, className }) => {
    const { config } = useAppContext();

    const handleChange = useCallback(
      (val: string) => onChange(val),
      [onChange]
    );

    const isDark = config.theme === "dark" || config.theme === "one-dark-pro";

    const extensions = useMemo(() => {
      const exts = [
        markdown(),
        lineNumbers(),
        highlightActiveLine(),
        highlightActiveLineGutter(),
        foldGutter(),
        bracketMatching(),
        closeBrackets(),
        indentOnInput(),
        drawSelection(),
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        keymap.of([...closeBracketsKeymap, ...defaultKeymap]),
        getCmFontStyle(config.fontFamily, config.editorFontSize),
      ];

      if (isDark) exts.push(oneDark);

      return exts;
    }, [config.theme, config.fontFamily, config.editorFontSize, isDark]);

    return (
      <CodeMirror
        value={value}
        onChange={handleChange}
        extensions={extensions}
        placeholder={placeholder}
        className={className}
        basicSetup={false}
      />
    );
  }
);
MarkdownEditor.displayName = "MarkdownEditor";
export default MarkdownEditor;
