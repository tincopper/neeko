import { Plus } from 'lucide-react';
import React from 'react';

import { cn } from '@/lib/utils';

/**
 * 列表态的页头：标题 + 「新建团队」这个**常驻入口**。
 *
 * 列表优先 + 视图推入的导航模型里，列表是主面，创建是一个按钮推入的整屏视图 ——
 * 「新建」因此必须常驻（埋在滚动深处等于让用户找入口）。纯呈现，动作由宿主传入。
 */
interface TeamListPageHeaderProps {
  onCreate: () => void;
}

const TeamListPageHeader: React.FC<TeamListPageHeaderProps> = React.memo(({ onCreate }) => (
  <header className="flex items-center gap-2 border-b border-border px-3 py-2.5">
    <div className="min-w-0 flex-1">
      <div className="text-ui font-semibold text-text-primary">团队</div>
      <div className="text-micro text-text-muted">多 Agent 协作：队长派活，成员认领</div>
    </div>
    <button
      type="button"
      onClick={onCreate}
      className={cn(
        'flex shrink-0 items-center gap-1 rounded-md bg-accent-blue px-2 py-1 text-micro font-semibold',
        'text-text-on-accent hover:brightness-110',
        'focus-visible:ring-2 focus-visible:ring-accent-blue focus-visible:outline-none',
      )}
    >
      <Plus size={12} aria-hidden="true" />
      新建团队
    </button>
  </header>
));
TeamListPageHeader.displayName = 'TeamListPageHeader';

export default TeamListPageHeader;
