import { useCallback, useState } from 'react';

interface UserInputPanelProps {
  /** The question prompt from the agent. */
  prompt: string;
  /** Available answer options. Empty/absent → free-text input. */
  options?: string[];
  /** Whether multiple options can be selected. */
  multiSelect?: boolean;
  /** Callback with the selected option(s) or free-text answer. */
  onSubmit: (selected: string[]) => void;
}

/**
 * 用户输入面板 —— Agent 使用 AskUserQuestion 工具时显示。
 * - 有 options：单选（选择后自动提交）或多选（需手动提交），带数字快捷键提示。
 * - 无 options：自由文本输入 + Send 按钮。
 */
export default function UserInputPanel({
  prompt,
  options = [],
  multiSelect = false,
  onSubmit,
}: UserInputPanelProps) {
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [text, setText] = useState('');

  const hasOptions = options.length > 0;

  const toggle = useCallback(
    (index: number) => {
      if (multiSelect) {
        setSelected((prev) => {
          const next = new Set(prev);
          if (next.has(index)) {
            next.delete(index);
          } else {
            next.add(index);
          }
          return next;
        });
      } else {
        // 单选模式：直接提交
        onSubmit([options[index]]);
      }
    },
    [multiSelect, onSubmit, options],
  );

  const handleSubmit = useCallback(() => {
    if (hasOptions) {
      const result = [...selected].sort((a, b) => a - b).map((i) => options[i]);
      onSubmit(result);
    } else {
      onSubmit([text]);
    }
  }, [hasOptions, selected, onSubmit, options, text]);

  return (
    <div className="user-input-panel" data-testid="user-input-panel">
      <div className="uip-prompt">{prompt}</div>
      {hasOptions ? (
        <>
          <div className="uip-options">
            {options.map((opt, i) => (
              <button
                key={i}
                type="button"
                className={`uip-option${selected.has(i) ? ' selected' : ''}`}
                onClick={() => toggle(i)}
              >
                <span className="choice-num">{i + 1}</span>
                <span className="uip-option-text">{opt}</span>
              </button>
            ))}
          </div>
          {multiSelect && (
            <button type="button" className="uip-submit" onClick={handleSubmit}>
              Next →
            </button>
          )}
        </>
      ) : (
        <div className="uip-text-input">
          <input
            type="text"
            placeholder="Type your answer..."
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <button type="button" className="uip-submit" onClick={handleSubmit}>
            Send
          </button>
        </div>
      )}
    </div>
  );
}
