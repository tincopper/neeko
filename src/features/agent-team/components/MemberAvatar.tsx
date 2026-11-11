import React from 'react';

import { cn } from '@/lib/utils';

import { memberInitial, memberTint, MEMBER_TINT_CLASS } from '../utils/memberTint';

import { AgentIcon, hasBrandIcon } from './AgentIcon';

/**
 * 成员头像：首字母 + **按 `memberId` 派生**的身份色。
 *
 * # 颜色与「谁」绑定，不与「第几行」绑定
 *
 * 取色只由 [`memberTint`](../utils/memberTint.ts) 按 `memberId` 决定 —— 加一个成员不会让
 * 后面所有人的颜色错位。颜色在这里只是记忆线索，**不承载状态语义**（状态是
 * `MemberStateBadge` 的事），所以它不必也不可能与状态对齐。
 *
 * `data-tint` 是测试与将来做筛选用稳定钩子：token class 会随主题变，tone 不会。
 */
interface MemberAvatarProps {
  /** 派生身份色的唯一输入。 */
  memberId: string;
  /** 取首字母的唯一输入。 */
  name: string;
  /** 跑的是哪个 CLI —— 有官方品牌图标时用它（`undefined` = 调用方不知道，走回退）。 */
  agentId?: string;
}

const MemberAvatar: React.FC<MemberAvatarProps> = React.memo(({ memberId, name, agentId }) => {
  const tint = memberTint(memberId);
  // 品牌 icon 覆盖首字母：图标的辨识度高于字母，而 tint 色仍是身份的兜底（无品牌时）。
  if (agentId !== undefined && hasBrandIcon(agentId)) {
    return (
      <span
        data-tint={tint}
        className="grid size-5 shrink-0 place-items-center rounded bg-bg-tertiary"
      >
        <AgentIcon agentId={agentId} name={name} size={14} label={agentId} />
      </span>
    );
  }
  return (
    <span
      aria-hidden="true"
      data-tint={tint}
      className={cn(
        'grid size-5 shrink-0 place-items-center rounded text-micro font-bold select-none',
        MEMBER_TINT_CLASS[tint],
      )}
    >
      {memberInitial(name)}
    </span>
  );
});
MemberAvatar.displayName = 'MemberAvatar';

export default MemberAvatar;
