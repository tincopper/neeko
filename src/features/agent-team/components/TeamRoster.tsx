import React from 'react';

import type { MemberStatusView } from '@/shared/types/team';

import { leaseRemainingText, memberRoleLabel } from '../utils/memberBadge';

import MemberStateBadge from './MemberStateBadge';

/**
 * 花名册（原型视图 ① 左栏）。
 *
 * 每行只有派生值：名字 / 角色 / 六态徽标 / 租约剩余秒。**没有任何可编辑字段、没有正文** ——
 * 花名册是「当前谁在干什么」的一瞥，不是成员详情（详情在后续阶段，按需拉）。
 *
 * 成员顺序由后端给（按 id 排序）：前端重排会让「同一个人在列表里位置漂移」，
 * 而眨眼扫视面板时位置本身是记忆线索。
 */
interface TeamRosterProps {
  members: readonly MemberStatusView[];
}

const TeamRoster: React.FC<TeamRosterProps> = React.memo(({ members }) => (
  <section aria-label="成员花名册" className="flex flex-col gap-1 p-2">
    <header className="flex items-center justify-between px-1 pb-1">
      <h3 className="text-meta font-semibold text-text-secondary">成员</h3>
      <span className="text-micro text-text-muted">{members.length} 名</span>
    </header>
    {members.length === 0 ? (
      <p className="px-1 py-2 text-meta text-text-muted">还没有成员</p>
    ) : (
      <ul className="flex flex-col gap-1">
        {members.map((member) => (
          <li
            key={member.memberId}
            data-member-id={member.memberId}
            className="flex flex-col gap-1 rounded-md border border-border bg-bg-secondary px-2 py-1.5"
          >
            <div className="flex items-center gap-1.5">
              <span className="min-w-0 flex-1 truncate text-ui font-medium text-text-primary">
                {member.name}
              </span>
              <MemberStateBadge member={member} />
            </div>
            <div className="flex items-center gap-2 text-micro text-text-muted">
              <span>{memberRoleLabel(member.role)}</span>
              <span aria-hidden="true">·</span>
              {/* `null`（无在飞任务）/ `0`（已超时）/ `>0`（剩余）三态文案不同 */}
              <span>{leaseRemainingText(member.leaseRemainingSecs)}</span>
            </div>
          </li>
        ))}
      </ul>
    )}
  </section>
));
TeamRoster.displayName = 'TeamRoster';

export default TeamRoster;
