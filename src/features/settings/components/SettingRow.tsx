/** 设置面板通用行组件：左标题+描述、右控件（Editor / Git / LSP 面板共用）。 */

import React from 'react';

function SettingRow({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between py-3 border-b border-white/[0.04] gap-6 last:border-b-0">
      <div className="flex-1 min-w-0">
        <div className="text-[0.86em] text-text-primary font-medium mb-0.75">{title}</div>
        <div className="text-[0.79em] text-text-muted leading-relaxed">{description}</div>
      </div>
      <div className="flex items-center gap-2 shrink-0">{children}</div>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5 w-full">
      <span className="text-[0.79em] text-text-muted font-medium">{label}</span>
      {children}
      {hint ? <span className="text-[0.72em] text-text-muted/80 leading-snug">{hint}</span> : null}
    </label>
  );
}

export { Field };
export default SettingRow;
