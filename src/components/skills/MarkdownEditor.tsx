import React, { useCallback, useMemo } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { lineNumbers, highlightActiveLine, highlightActiveLineGutter, drawSelection, keymap } from "@codemirror/view";
import { defaultKeymap } from "@codemirror/commands";
import { foldGutter, indentOnInput, bracketMatching } from "@codemirror/language";
import { closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete";
import { getCmFontStyle, getCmSyntaxHighlighting } from "../../utils/codemirror";
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

    const extensions = useMemo(() => {
      const exts: import("@codemirror/state").Extension[] = [
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
        getCmFontStyle(config.fontFamily, config.editorFontSize),
        getCmSyntaxHighlighting(),
      ];

      return exts;
    }, [config.fontFamily, config.editorFontSize, config.theme]);

    return (
      <CodeMirror
        value={value}
        onChange={handleChange}
        extensions={extensions}
        placeholder={placeholder}
        className={className}
        theme={undefined}
        basicSetup={false}
      />
    );
  }
);
MarkdownEditor.displayName = "MarkdownEditor";
export default MarkdownEditor;
