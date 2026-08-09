import React from 'react';

import { SkillContent, SkillsPanel } from '@/features/skill';

/**
 * Library Skills tab — 列表岛（SkillsPanel 导航）+ 内容岛（SkillContent）。
 *
 * 复刻 App.tsx 的拆分模式：导航与内容分离，通过 skillStore 状态协同。
 * 两岛各自独立（rounded-lg border shadow-sm bg-bg-secondary），间隙露出 bg-primary 海面，
 * 与 DockLayout 的 island 语言保持一致。SkillContent 内含 4 个子视图路由与全部对话框。
 */
const SkillsTabContent: React.FC = React.memo(() => {
  return (
    <div className="flex h-full min-h-0 overflow-hidden gap-1">
      {/* 列表岛：SkillsPanel 导航（固定宽度，无描边对齐 DockZone 岛屿） */}
      <div className="w-44 shrink-0 rounded-lg shadow-sm bg-bg-secondary overflow-hidden">
        <SkillsPanel />
      </div>
      {/* 内容岛：SkillContent（flex-1 min-h-0，外包岛屿外壳保证内部滚动） */}
      <div className="flex-1 min-w-0 rounded-lg shadow-sm bg-bg-secondary overflow-hidden">
        <SkillContent />
      </div>
    </div>
  );
});

SkillsTabContent.displayName = 'SkillsTabContent';

export default SkillsTabContent;
