import React from 'react';

import { cn } from '@/lib/utils';

import { memberInitial, memberTint, type MemberTintTone } from '../utils/memberTint';

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
const TINT_CLASS: Record<MemberTintTone, string> = {
  blue: 'bg-accent-blue/20 text-accent-blue',
  green: 'bg-accent-green/20 text-accent-green',
  orange: 'bg-accent-orange/20 text-accent-orange',
  brick: 'bg-accent-brick/20 text-accent-brick',
  yellow: 'bg-accent-yellow/20 text-accent-yellow',
};

interface MemberAvatarProps {
  /** 派生身份色的唯一输入。 */
  memberId: string;
  /** 取首字母的唯一输入。 */
  name: string;
}

const MemberAvatar: React.FC<MemberAvatarProps> = React.memo(({ memberId, name }) => {
  const tint = memberTint(memberId);
  return (
    <span
      aria-hidden="true"
      data-tint={tint}
      className={cn(
        'grid size-5 shrink-0 place-items-center rounded text-micro font-bold select-none',
        TINT_CLASS[tint],
      )}
    >
      {memberInitial(name)}
    </span>
  );
});
MemberAvatar.displayName = 'MemberAvatar';

export default MemberAvatar;
