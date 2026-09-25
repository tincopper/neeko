import { useCallback, useState } from 'react';

/**
 * 变更列表的文件选中域：勾选 / 单项摘除 / 整批清空。
 *
 * 三种变更语义各有调用方（toggle=用户勾选、remove=discard 成功后的局部摘除、
 * clear=commit 消费整批后的清空），状态收拢在一处才能保证「摘除不清掉其余、
 * 清空不留残留」的语义不漂移。
 */
export function useFileSelection() {
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());

  const toggleFile = useCallback((path: string) => {
    setSelectedFiles((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }, []);

  /** 只移除指定路径（discard 成功后）：丢弃是局部操作，不连带清掉其余勾选。 */
  const removeSelected = useCallback((paths: readonly string[]) => {
    setSelectedFiles((prev) => {
      const next = new Set(prev);
      for (const path of paths) next.delete(path);
      return next;
    });
  }, []);

  /** 整批清空（commit 成功后：整批已消费）。 */
  const clearSelected = useCallback(() => {
    setSelectedFiles(new Set());
  }, []);

  return { selectedFiles, toggleFile, removeSelected, clearSelected };
}
