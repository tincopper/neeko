import React from 'react';
import type { SkillListSectionProps } from './skillItemTypes';
import SkillCard from './SkillCard';
import { cn } from '@/lib/utils';

// ─── Skeleton ────────────────────────────────────────────────────────────────

const SKELETON_COUNT = 8;

const SkillCardSkeleton: React.FC = () => (
  <div className="rounded-md border border-border bg-bg-secondary p-2 flex flex-col gap-1.5 animate-pulse">
    <div className="h-3 w-3/4 rounded bg-bg-hover" />
    <div className="h-2 w-full rounded bg-bg-hover" />
    <div className="h-2 w-2/3 rounded bg-bg-hover" />
    <div className="flex gap-1 mt-1">
      <div className="h-2 w-8 rounded-full bg-bg-hover" />
      <div className="h-2 w-10 rounded-full bg-bg-hover" />
    </div>
  </div>
);

// ─── Component ───────────────────────────────────────────────────────────────

/**
 * Skill 卡片列表（纯展示层，对标 SessionRow / ProjectGroup）�?
 *
 * 职责�?
 * - 根据传入�?skills 渲染 skeleton / empty / grid
 * - 通过 actions 接口触发操作，不直接访问 store
 *
 * 不负责：过滤（由 LocalSkillContent �?useMemo 完成）、store 订阅�?
 */
const SkillListSection: React.FC<SkillListSectionProps> = React.memo(
  ({ skills, loading, selectedSkillId, actions }) => {
    const { onSelectSkill, onEditSkill, onViewSkill, onDeleteSkill } = actions;

    return (
      <section className="border-b border-border">
        <div className="px-3 py-1.5 text-[11px] font-medium text-text-muted uppercase tracking-wider">
          {loading ? 'Skills' : `Skills (${skills.length})`}
        </div>

        <div className={cn('pb-1', loading && 'p-2')}>
          {loading ? (
            <div className="grid grid-cols-4 gap-2 p-2">
              {Array.from({ length: SKELETON_COUNT }).map((_, i) => (
                <SkillCardSkeleton key={i} />
              ))}
            </div>
          ) : skills.length === 0 ? (
            <div className="px-3 py-4 text-center text-[var(--font-size)] text-text-muted">
              No skills found
            </div>
          ) : (
            <div className="grid grid-cols-4 gap-2 p-2">
              {skills.map(s => (
                <SkillCard
                  key={s.id}
                  skill={s}
                  isSelected={selectedSkillId === s.id}
                  onSelect={() => onSelectSkill(s.id === selectedSkillId ? null : s.id)}
                  onAction={action => {
                    if (action === 'delete') onDeleteSkill(s.id);
                    else if (action === 'edit') onEditSkill(s);
                    else if (action === 'detail') onViewSkill(s);
                  }}
                />
              ))}
            </div>
          )}
        </div>
      </section>
    );
  },
);

SkillListSection.displayName = 'SkillListSection';

export default SkillListSection;
