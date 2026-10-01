import React, { useCallback, useEffect } from 'react';

import { useInsertPromptToWorkspace } from '../hooks/useInsertPromptToWorkspace';
import { usePromptInsert } from '../hooks/usePromptInsert';
import { setPromptDialogHostMounted, useLibraryStore } from '../store/libraryStore';

import PromptEditorDialog from './PromptEditorDialog';
import PromptInsertDialog from './PromptInsertDialog';
import VariableDialog from './VariableDialog';

/**
 * Prompt 弹窗的**唯一挂载点**（store 驱动）。
 *
 * 存在的理由：弹窗开关是全局 store 状态，触发点却不只在 Library 视图（状态栏 Prompts chip、
 * 命令面板）。渲染点若落在懒挂载的 `LibraryPanel` 里（`AppCenter` 首次进入 Library 才挂载、
 * settings 视图整体卸载），flag 翻起时就没有消费者 —— 弹窗不出现、`openVariableDialog` 的
 * Promise 永久悬挂、插入静默丢失，直到用户哪天打开 Library 才看到过期表单。
 *
 * 生命周期：挂载时置位宿主就绪标记，卸载时清除并把在途请求按「未获得内容」结算 ——
 * 与 `ConfirmHost` 同一条不变式：**fail-closed，且绝不悬挂**。
 */
const PromptDialogHost: React.FC = () => {
  const variableRequest = useLibraryStore((s) => s.variableRequest);
  const settleVariableDialog = useLibraryStore((s) => s.settleVariableDialog);

  const deliverToWorkspace = useInsertPromptToWorkspace();
  const insert = usePromptInsert(deliverToWorkspace);

  useEffect(() => {
    setPromptDialogHostMounted(true);
    return () => {
      setPromptDialogHostMounted(false);
      useLibraryStore.getState().settleVariableDialog(null);
    };
  }, []);

  const handleVariableCancel = useCallback(
    () => settleVariableDialog(null),
    [settleVariableDialog],
  );

  return (
    <>
      <PromptEditorDialog />
      <PromptInsertDialog onInsert={insert} />
      {variableRequest !== null && (
        <VariableDialog
          content={variableRequest}
          onConfirm={settleVariableDialog}
          onCancel={handleVariableCancel}
        />
      )}
    </>
  );
};

export default React.memo(PromptDialogHost);
