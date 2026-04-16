import React, { useCallback, useMemo } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { markdown } from "@codemirror/lang-markdown";
import { oneDark } from "@codemirror/theme-one-dark";
import { EditorView } from "@codemirror/view";
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
      const exts = [
        markdown(),
        EditorView.theme({
          "&": {
            fontSize: `${config.editorFontSize}px`,
            fontFamily: config.fontFamily,
            backgroundColor: "transparent",
            color: "var(--text-primary)",
            height: "100%",
          },
          ".cm-scroller": {
            overflow: "auto",
            fontFamily: "inherit",
          },
          ".cm-content": {
            fontFamily: "inherit",
            caretColor: "var(--accent-blue)",
          },
          ".cm-cursor, .cm-dropCursor": {
            borderLeftColor: "var(--accent-blue)",
          },
          ".cm-activeLine": {
            backgroundColor: "rgba(0,0,0,0.08)",
          },
          ".cm-gutters": {
            backgroundColor: "transparent",
            color: "var(--text-muted)",
            border: "none",
          },
        }),
      ];

      if (
        config.theme === "dark" ||
        config.theme === "one-dark-pro"
      ) {
        exts.push(oneDark);
      }

      return exts;
    }, [config.theme, config.fontFamily, config.editorFontSize]);

    return (
      <CodeMirror
        value={value}
        onChange={handleChange}
        extensions={extensions}
        placeholder={placeholder}
        className={className}
        basicSetup={{
          lineNumbers: true,
          highlightActiveLine: true,
          foldGutter: true,
          bracketMatching: true,
          closeBrackets: true,
          autocompletion: false,
          indentOnInput: true,
        }}
      />
    );
  }
);
MarkdownEditor.displayName = "MarkdownEditor";
export default MarkdownEditor;
