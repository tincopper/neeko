import React from 'react';

import { AgentIcon as AgentConfigIcon } from '@/features/agent';
import { cn } from '@/lib/utils';

import { useMemberAgentIcon } from '../hooks/useMemberAgentIcon';
import { memberInitial, memberTint, MEMBER_TINT_CLASS } from '../utils/memberTint';

/**
 * 成员头像里的 agent 图标 = **tab 栏 / agent 列表用的那一份**（复用，不另建一套）。
 *
 * 图标的来源只有一个（[`useMemberAgentIcon`]）：`AgentConfig.icon` 经 `features/agent` 的
 * 门面组件解析（preset / 用户上传路径 / 加载失败兜底）。团队侧不再持有任何品牌表 ——
 * 那份手抄的 Simple Icons 表就是「pi / codebuddy 的成员只有首字母」的成因。
 *
 * # 回退
 *
 * 没有图标（`icon === null`）⇒ 首字母 + 按 `agentId` 派生的身份色。有图标时那枚首字母仍作为
 * **加载失败**的兜底交给图标容器（它负责 `onError`），所以两条路径都画得出东西。
 */
interface AgentIconProps {
  agentId: string;
  /** 无图标时的回退字形来源（显示名）。 */
  name: string;
  size?: number;
  className?: string;
  /**
   * 可访问名：成员头像传 agentId（读屏听到「哪个 agent」）；选择卡等**装饰**场景
   * 不传 —— 卡片自己的可访问名已含 agent 名，图标只是视觉强化。
   */
  label?: string;
}

export const AgentIcon: React.FC<AgentIconProps> = React.memo(
  ({ agentId, name, size = 15, className, label }) => {
    const icon = useMemberAgentIcon(agentId);
    // 身份色只派生一次（两个分支都要它，而 `memberTint` 每次都是一次查表 + 取模）。
    const tint = memberTint(agentId);
    const initialsClass = cn(
      'grid shrink-0 place-items-center rounded font-bold select-none',
      MEMBER_TINT_CLASS[tint],
    );
    const initialsStyle = { width: size, height: size, fontSize: size * 0.45 };

    // 没有 `icon` 就没有可显示的东西（`AgentConfig.icon` 为 `null`，或 agent 不在配置里）：
    // 直接画首字母（并把调用方的行级排版带上）。
    if (icon === null) {
      return (
        <span
          aria-hidden="true"
          data-tint={tint}
          className={cn(initialsClass, className)}
          style={initialsStyle}
        >
          {memberInitial(name)}
        </span>
      );
    }

    // 有 `icon` 时交给 agent 域那一个容器：preset 解析、自定义路径的 `convertFileSrc` 与
    // **加载失败**兜底都在它那里（失败也回退到这枚首字母，而不是留下一块空白）。
    return (
      <AgentConfigIcon
        icon={icon}
        size={size}
        className={className}
        alt={label}
        fallback={
          <span aria-hidden="true" data-tint={tint} className={initialsClass} style={initialsStyle}>
            {memberInitial(name)}
          </span>
        }
      />
    );
  },
);
AgentIcon.displayName = 'AgentIcon';
