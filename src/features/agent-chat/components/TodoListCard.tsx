import type { TodoItem } from '@/shared/types/agentChat';

/** Codex 风格任务状态图标。 */
export function todoGlyph(status: TodoItem['status']): string {
  if (status === 'completed') return '✓';
  if (status === 'in_progress') return '◐';
  if (status === 'cancelled') return '✕';
  return '○';
}

/**
 * Codex 风格任务清单块 —— 对齐 OpenAI Codex CLI 的 TodoWrite 展示：
 * `✓/◐/○/✕ 状态图标 + 任务描述`。由 `todo_updated` 事件驱动，实时反映
 * agent 的计划执行进度（pending → in_progress → completed）。
 */
export default function TodoListCard({ todos }: { todos: TodoItem[] }) {
  return (
    <div className="todo-card" data-testid="todo-card">
      {todos.map((todo, i) => (
        <div
          key={`${todo.content}-${i}`}
          className={`todo-row ${todo.status}`}
          data-testid="todo-row"
        >
          <span className="todo-glyph" aria-hidden="true">
            {todoGlyph(todo.status)}
          </span>
          <span className="todo-content">{todo.content}</span>
          {todo.priority !== 'medium' && (
            <span className={`todo-priority ${todo.priority}`}>{todo.priority}</span>
          )}
        </div>
      ))}
    </div>
  );
}
