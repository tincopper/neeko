import { useCallback, useState } from 'react';

import type { DiscardIntent } from '../utils/discardIntent';

/**
 * Discard 二次确认流的状态机：request（任一 UI 入口）→ confirm / cancel。
 *
 * `paths` 在 request 时定死 —— 确认文案描述的范围与 confirm 执行的范围是同一份
 * 数据，confirm 只回传原 intent，不做任何二次解析（否则二次确认就成了谎言）。
 */
export function useDiscardConfirm(execute: (intent: DiscardIntent) => void) {
  const [pending, setPending] = useState<DiscardIntent | null>(null);

  /** 丢弃请求入口：单行 / 选中 / 整组都经此打开确认弹窗（无一处直通执行）。 */
  const request = useCallback((intent: DiscardIntent) => {
    setPending(intent);
  }, []);

  const cancel = useCallback(() => {
    setPending(null);
  }, []);

  /** 确认即关闭弹窗再执行：执行结果经 toast 反馈，弹窗内不留 loading 态。 */
  const confirm = useCallback(
    (intent: DiscardIntent) => {
      setPending(null);
      execute(intent);
    },
    [execute],
  );

  return { pending, request, cancel, confirm };
}
