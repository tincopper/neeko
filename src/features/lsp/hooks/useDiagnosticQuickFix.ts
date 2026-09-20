import { useCallback, useRef, useState } from 'react';

import {
  applyCodeAction,
  groupQuickFixActions,
  requestCodeActions,
  type LspCodeAction,
  type QuickFixMenuSection,
} from '../api/codeAction';
import type { LspDiagnostic } from '../types';

/**
 * 单条诊断的 quickfix 状态机：展开时拉 codeAction，选中某项时应用。
 *
 * 拉取放在"展开"而不是"渲染每一行"：一次 publishDiagnostics 可能几十条诊断，
 * 逐条预取会把 `textDocument/codeAction` 放大成几十个请求。
 */
interface UseDiagnosticQuickFixParams {
  projectPath: string | null;
  /** 语言 ID；null（扩展名无法识别）时整行不显示灯泡。 */
  languageId: string | null;
  uri: string;
  diagnostic: LspDiagnostic;
}

export function useDiagnosticQuickFix({
  projectPath,
  languageId,
  uri,
  diagnostic,
}: UseDiagnosticQuickFixParams) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sections, setSections] = useState<QuickFixMenuSection[]>([]);
  // 原始动作只留在 ref 里：菜单只渲染标题，应用时要拿回带 `edit` 的完整对象
  const actionsRef = useRef<LspCodeAction[]>([]);

  const close = useCallback(() => setOpen(false), []);

  const toggle = useCallback(async () => {
    if (open) {
      setOpen(false);
      return;
    }
    setOpen(true);
    if (!projectPath || !languageId || actionsRef.current.length > 0 || busy) return;
    setBusy(true);
    try {
      const actions = await requestCodeActions(projectPath, languageId, uri, diagnostic.range, [
        diagnostic,
      ]);
      actionsRef.current = actions;
      // 与编辑器内菜单共用同一份平铺分组（VS Code 形态），两端结构不各自漂移
      setSections(groupQuickFixActions(actions));
    } finally {
      setBusy(false);
    }
  }, [open, busy, projectPath, languageId, uri, diagnostic]);

  /** 按标题应用；成功则关闭菜单。false = 没落地（菜单保持打开让用户看到）。 */
  const apply = useCallback(
    (title: string): boolean => {
      const action = actionsRef.current.find((a) => a.title === title);
      if (!action) return false;
      const applied = applyCodeAction(uri, action);
      if (applied) setOpen(false);
      return applied;
    },
    [uri],
  );

  return { open, busy, sections, toggle, apply, close };
}
