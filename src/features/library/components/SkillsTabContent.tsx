import React from 'react';

import SkillsPanel from '@/features/skill/components/SkillsPanel';

/**
 * Embeds the existing SkillsPanel inside the Library Skills tab.
 *
 * The SkillsPanel owns its own view state (Library / Marketplace / Agents /
 * Projects / Tags) via the skillStore — we render it as-is and let it manage
 * its internal navigation. This preserves 100% of existing skill behavior.
 */
const SkillsTabContent: React.FC = React.memo(() => {
  return (
    <div className="h-full min-h-0 overflow-hidden">
      <SkillsPanel />
    </div>
  );
});

SkillsTabContent.displayName = 'SkillsTabContent';

export default SkillsTabContent;
