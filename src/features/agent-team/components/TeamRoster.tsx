import React from 'react';

import type { MemberStatusView } from '@/shared/types/team';

import RosterRow from './RosterRow';

/**
 * 花名册（原型视图 ① 左栏）。
 *
 * 每行只有派生值（见 [`RosterRow`]）。**没有任何可编辑字段、没有正文** —— 花名册是
 * 「当前谁在干什么」的一瞥，不是成员详情（详情在后续阶段，按需拉）。
 *
 * # 顺序由后端给
 *
 * 成员按 id 排序是后端的决定：前端重排会让「同一个人在列表里位置漂移」，而眨眼扫视面板时
 * 位置本身是记忆线索。头像色因此**不能**依赖位置（见 `utils/memberTint`）。
 *
 * # C 档说明为什么只在有 C 档成员时出现
 *
 * 「卡住永远不可知」这句话如果没有 C 档成员也在，就成了永久装饰 —— 用户读两次之后就不再读它，
 * 真有 C 档成员时也一并忽略。
 */
interface TeamRosterProps {
  members: readonly MemberStatusView[];
  /** 打开某个成员的 PTY 终端（透传给每行）。 */
  onOpenTerminal: (terminalId: string, title: string, agentId: string | undefined) => void;
  /** 打开已退出成员的历史会话（`conversation` tab）。 */
  onOpenHistory?: (agentId: string, agentSessionId: string, title: string) => void;
  /** 打开某个成员的详情抽屉（点行的主体区域；与「打开会话」是两个动作）。 */
  onOpenMember: (memberId: string) => void;
}

const TeamRoster: React.FC<TeamRosterProps> = React.memo(
  ({ members, onOpenTerminal, onOpenMember, onOpenHistory }) => {
    const hasSentinelOnly = members.some((member) => member.tier === 'c');

    return (
      <section aria-label="成员花名册" className="flex flex-col gap-1 p-2">
        <header className="flex items-center justify-between px-1 pb-1">
          <h3 className="text-meta font-semibold text-text-secondary">成员</h3>
          {/*
            这是**花名册行数**（含队长），不是「团队有几个成员」—— 后者是后端口径
            （不含队长，见 `utils/memberCount`），显示在面板头的 pill 里。两个数字对不上是
            设计如此，所以这里把口径写进文案：不写清楚就变成「同一个队有第三个成员数」。
          */}
          <span className="text-micro text-text-muted" title="花名册行数，含队长">
            {`${members.length} 人（含队长）`}
          </span>
        </header>
        {members.length === 0 ? (
          <p className="px-1 py-2 text-meta text-text-muted">还没有成员</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {members.map((member) => (
              <RosterRow
                key={member.memberId}
                member={member}
                onOpenTerminal={onOpenTerminal}
                onOpenMember={onOpenMember}
                onOpenHistory={onOpenHistory}
              />
            ))}
          </ul>
        )}
        {hasSentinelOnly ? (
          // 红线 14 的 UI 侧：C 档的完成能报（sentinel），卡住永远不可知 —— 不许写「正在工作」。
          <p
            role="note"
            className="rounded-md border border-accent-yellow bg-accent-yellow/10 px-2 py-1 text-micro text-accent-yellow"
          >
            C 档成员（sentinel only）：完成能报，但卡住永远不可知 → 只会写「可能等待输入」
          </p>
        ) : null}
      </section>
    );
  },
);
TeamRoster.displayName = 'TeamRoster';

export default TeamRoster;
