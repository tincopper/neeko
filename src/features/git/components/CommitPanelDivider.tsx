import React from 'react';

interface CommitPanelDividerProps {
  onMouseDown: (event: React.MouseEvent) => void;
}

/**
 * 变更列表与 Commit 表单之间的可拖拽分隔条（调整提交区高度）。
 *
 * 纯展示组件：拖拽行为由 `useDividerDrag` 持有，这里只把事件转出去。
 * a11y 豁免用**块级**注释（`eslint-disable-next-line` 只覆盖紧邻一行，
 * 而告警落在 `tabIndex` / `onMouseDown` 两个属性行上）。
 */
const CommitPanelDivider: React.FC<CommitPanelDividerProps> = ({ onMouseDown }) => (
  <>
    {/* eslint-disable jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-noninteractive-tabindex */}
    <div
      role="separator"
      tabIndex={0}
      className="group h-1.5 shrink-0 cursor-row-resize flex items-center justify-center"
      aria-orientation="horizontal"
      aria-label="Resize commit area"
      onMouseDown={onMouseDown}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
        }
      }}
    >
      <div className="w-8 h-[3px] rounded-full bg-border group-hover:bg-accent-blue/50 transition-colors duration-150" />
    </div>
    {/* eslint-enable jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-noninteractive-tabindex */}
  </>
);

export default React.memo(CommitPanelDivider);
