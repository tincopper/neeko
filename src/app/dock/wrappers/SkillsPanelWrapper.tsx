import React from 'react';

import { SkillsPanel } from '@/features/skill';

/**
 * Skills dock 面板适配层：数据来自全局 skillStore 单例，无需 Provider。
 */
const SkillsPanelWrapper: React.FC = React.memo(() => {
  return <SkillsPanel />;
});
SkillsPanelWrapper.displayName = 'SkillsPanelWrapper';

export default SkillsPanelWrapper;
export { SkillsPanelWrapper };
