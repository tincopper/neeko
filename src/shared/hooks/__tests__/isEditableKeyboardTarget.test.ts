import { describe, it, expect } from 'vitest';
import { isEditableKeyboardTarget } from '@/shared/hooks/useKeyboardShortcuts';

describe('isEditableKeyboardTarget', () => {
  it('should_treat_input_as_editable', () => {
    const input = document.createElement('input');
    document.body.appendChild(input);
    expect(isEditableKeyboardTarget(input)).toBe(true);
    input.remove();
  });

  it('should_not_treat_codemirror_contenteditable_as_blocking_editable', () => {
    const root = document.createElement('div');
    root.className = 'cm-editor';
    const content = document.createElement('div');
    content.className = 'cm-content';
    content.contentEditable = 'true';
    content.setAttribute('role', 'textbox');
    root.appendChild(content);
    document.body.appendChild(root);

    expect(isEditableKeyboardTarget(content)).toBe(false);
    expect(isEditableKeyboardTarget(root)).toBe(false);
    root.remove();
  });

  it('should_treat_generic_contenteditable_as_editable', () => {
    const div = document.createElement('div');
    div.setAttribute('contenteditable', 'true');
    document.body.appendChild(div);
    expect(isEditableKeyboardTarget(div)).toBe(true);
    div.remove();
  });
});
