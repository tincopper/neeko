import { useCallback, useEffect, useRef } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';

import { isPanelInteractiveTarget } from '../utils/fileTreeUtils';

interface UsePanelDeselectParams {
  /** 选中项目根（面板内空白点击 / header 空白点击） */
  handleSelectNode: (path: string, isDir: boolean) => void;
  /** 清除节点选中（点击面板外任意处） */
  clearSelection: () => void;
}

/**
 * 文件面板取消选中 / 选中根 的数据流收口：
 * - 点击面板内非交互区域（header 空白 / 列表空白 / 无文件处）→ 选中项目根
 *   （节点行已 stopPropagation；按钮 / 输入 / 菜单项等交互控件经
 *   `isPanelInteractiveTarget` 排除）；
 * - 点击面板外任意处（编辑器 / 其他面板等非目录区域）→ 清除节点选中，
 *   新建目标回到根（getCreationDir 对 null 返回 ''）。
 *
 * 返回 `panelRef`（根容器 ref，供面板外判定）与 `handlePanelBackgroundClick`
 * （根容器 onClick）。document 级监听在组件卸载时移除。
 */
export function usePanelDeselect({ handleSelectNode, clearSelection }: UsePanelDeselectParams) {
  const panelRef = useRef<HTMLDivElement | null>(null);

  // 稳定包装：参数为 useFilePanelState 的稳定 useCallback，避免 effect 反复重挂
  const onSelectRoot = useCallback(() => handleSelectNode('', true), [handleSelectNode]);
  const onClear = useCallback(() => clearSelection(), [clearSelection]);

  // 点击面板非交互区域 → 选中项目根。role=presentation 遵循项目空白点击先例
  // （SettingsPanel / OverlayPanel）。
  const handlePanelBackgroundClick = useCallback(
    (e: ReactMouseEvent<HTMLDivElement>) => {
      if (isPanelInteractiveTarget(e.target as HTMLElement)) {
        return;
      }
      onSelectRoot();
    },
    [onSelectRoot],
  );

  // 全局取消选中：点击面板外任意处清除节点选中
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onClear();
      }
    };
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, [onClear]);

  return { panelRef, handlePanelBackgroundClick };
}
