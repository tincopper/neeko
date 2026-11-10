import React from 'react';

/**
 * 创建流的步骤标号（1/2/3）。纯呈现，无状态 —— 分组让长表单有坐标。
 */
const StepHead: React.FC<{ n: number; title: string; hint?: string }> = React.memo(
  ({ n, title, hint }) => (
    <div className="flex items-center gap-2 px-1">
      <span
        aria-hidden="true"
        className="grid size-[17px] shrink-0 place-items-center rounded-full bg-accent-blue/10 text-micro font-bold text-accent-blue"
      >
        {n}
      </span>
      <span className="text-meta font-semibold text-text-secondary">{title}</span>
      {hint ? <span className="ml-auto text-micro text-text-muted">{hint}</span> : null}
    </div>
  ),
);
StepHead.displayName = 'StepHead';

export default StepHead;
