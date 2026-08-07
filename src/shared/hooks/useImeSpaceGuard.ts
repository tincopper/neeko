import React, { useCallback } from 'react';

import { isAbandonedImeAsciiBuffer, stripImeSegmentationSpaces } from '@/shared/utils/ime';

/** 通用 IME 空格剥离 hook：供 input/textarea 使用。命中「被放弃的拼音缓冲区」时
 *  修正 DOM value 并派发 input 事件，驱动 React onChange 同步受控组件 state。 */
export function useImeSpaceGuard<T extends HTMLInputElement | HTMLTextAreaElement>() {
  const onCompositionEnd = useCallback((e: React.CompositionEvent<T>) => {
    const data = e.data;
    if (!data || !isAbandonedImeAsciiBuffer(data)) return;
    const el = e.currentTarget;
    const raw = el.value;
    // IME 提交总是发生在光标处：以 selectionStart 为锚点回退 data.length 精确定位，
    // 与 CodeMirror 端（head 回退）保持一致。lastIndexOf 会误伤值中已存在的相同文本。
    const start = el.selectionStart ?? raw.length;
    const idx = Math.max(0, start - data.length);
    if (raw.slice(idx, idx + data.length) !== data) return;
    const corrected =
      raw.slice(0, idx) + stripImeSegmentationSpaces(data) + raw.slice(idx + data.length);
    el.value = corrected;
    el.dispatchEvent(new InputEvent('input', { bubbles: true }));
  }, []);
  return { onCompositionEnd };
}
