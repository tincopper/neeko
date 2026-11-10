import { ChevronDown, ChevronRight, FolderOpen } from 'lucide-react';
import React, { useCallback, useState } from 'react';

import { cn } from '@/lib/utils';

import type { TeamRolesState } from '../hooks/useTeamRoles';

import RoleLibrarySection from './RoleLibrarySection';

/**
 * 建队面板里的**角色库折叠区块**（管理面，不是建队路径上的必经项）。
 *
 * # 为什么单独成组件
 *
 * 「建队三步」与「角色库的展开态 + 计数徽标」是两个独立的变化理由：前者跟着配置面
 * 演进，后者是管理面的导航。折叠是**就近 state**（一次查看动作，不进 store）——
 * 由本组件持有，面板不必为它多知道一个字段。
 *
 * 建队只消费角色库的「缺省角色」一个下拉（在 `TeamConfigSection` 里），所以这里默认
 * 折叠；`N` 计数让它不藏没影（不加计数就是「有个隐藏功能」）。
 */
interface RoleLibraryBlockProps {
  roles: TeamRolesState;
  /** `agentId` → 显示名（角色库里「建议 CLI」的展示）。 */
  nameOf: (agentId: string) => string;
  /** CLI 建议候选（建队面板已有的可启动清单）。 */
  agentIds: readonly string[];
  onShowToast?: (message: string, type?: 'info' | 'error') => void;
}

const RoleLibraryBlock: React.FC<RoleLibraryBlockProps> = React.memo(
  ({ roles, nameOf, agentIds, onShowToast }) => {
    const [open, setOpen] = useState(false);
    const toggle = useCallback(() => setOpen((prev) => !prev), []);

    const count = roles.roles?.length ?? 0;

    return (
      <div className="flex flex-col gap-2">
        <button
          type="button"
          aria-expanded={open}
          onClick={toggle}
          className={cn(
            'flex items-center gap-1.5 rounded-md px-1 py-0.5 text-meta font-semibold text-text-secondary',
            'hover:bg-bg-hover focus-visible:ring-2 focus-visible:ring-accent-blue focus-visible:outline-none',
          )}
        >
          {open ? (
            <ChevronDown size={13} aria-hidden="true" />
          ) : (
            <ChevronRight size={13} aria-hidden="true" />
          )}
          角色库
          {count > 0 ? (
            <span className="rounded-full bg-bg-tertiary px-1 text-micro font-normal text-text-muted">
              {count}
            </span>
          ) : null}
        </button>
        {open ? (
          <RoleLibrarySection
            roles={roles}
            nameOf={nameOf}
            agentIds={agentIds}
            onShowToast={onShowToast}
          />
        ) : null}
      </div>
    );
  },
);
RoleLibraryBlock.displayName = 'RoleLibraryBlock';

/** 步骤 3 里那一行「团队根」（只读展示；派生点在 `useActiveWorkspaceRoot`）。 */
export const TeamRootRow: React.FC<{ workspaceRoot: string | null }> = React.memo(
  ({ workspaceRoot }) => (
    <div className="flex items-center gap-1.5 rounded-md border border-border bg-bg-primary px-2 py-1.5">
      <FolderOpen size={13} aria-hidden="true" className="shrink-0 text-text-muted" />
      <span className="shrink-0 text-micro text-text-muted">团队根</span>
      <span className="min-w-0 flex-1 truncate text-right font-mono text-micro text-text-secondary">
        {workspaceRoot ?? '没有活动项目'}
      </span>
    </div>
  ),
);
TeamRootRow.displayName = 'TeamRootRow';

export { RoleLibraryBlock };
export default RoleLibraryBlock;
