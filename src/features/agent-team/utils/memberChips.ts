import type { AdmissionTier, MemberStatusView, WorkerChannel } from '@/shared/types/team';

import { workspaceLabel } from './workspaceLabel';

/**
 * 花名册那排 chip 的**唯一**文案 / 语义映射。
 *
 * # 为什么整排 chip 是一个纯函数，而不是组件里的几个三元
 *
 * 「这是谁 / 它在哪干活 / 它的能力边界是什么」这三件事决定了用户该不该信任一个成员，
 * 而它们各自的文案分散在组件里时，最典型的事故是 **C 档不带警告**：`tier === 'c'` 意味着
 * 「完成能报（sentinel），但卡住永远不可知」（红线 14），少写一句 UI 就会让人以为
 * 「没消息 = 在干活」。把整排 chip 收在这里，档位警告就和档位本身同一个表示点，
 * 组件只负责把 `tone` 映射成 token class。
 */

/** chip 的语义色（组件映射到 token class，颜色不在这里拼）。 */
export type MemberChipTone = 'default' | 'outline' | 'accent' | 'warn';

export interface MemberChip {
  /** 稳定机器键（文案会变，key 不会 —— 测试与将来做筛选用它）。 */
  key: 'agent' | 'persona' | 'channel' | 'workspace' | 'tier';
  text: string;
  tone: MemberChipTone;
  /** 完整理由（视觉文案太短，悬停 / 读屏拿「为什么」）。 */
  title: string;
}

const CHANNEL: Record<WorkerChannel, { text: string; title: string }> = {
  // `CLI · PTY` 是原型上的写法：成员是 Neeko 起的 PTY 进程，唯一能把字送进它回合的是
  // stdin（MCP over HTTP 是客户端发起的，我们**没有**反向推送通道 —— design §4.4）。
  pty: { text: 'CLI · PTY', title: '通道 pty：写 PTY stdin（CLI 成员的唯一通道）' },
  mcp: { text: 'MCP', title: '通道 mcp：经由 MCP 工具面派活' },
  none: { text: '无通道', title: '通道 none：只能一次性派活，无法继续对话' },
};

/**
 * 档位 chip。
 *
 * C 档**必须**带「sentinel only」这行可见文字：它唯一的含义就是「卡住永远不可知」，
 * 缩成 `C` 之后，用户在花名册上看到的与 A 档没有区别（红线 14 的 UI 侧）。
 */
const TIER: Record<AdmissionTier, { text: string; tone: MemberChipTone; title: string }> = {
  a: { text: 'A 档', tone: 'default', title: 'A 档：有 hook + MCP，完成 / 结果 / 卡住 全可见' },
  b: { text: 'B 档', tone: 'default', title: 'B 档：只有 hook，结果靠 sentinel 补，卡住仍可见' },
  c: {
    text: 'C 档 · sentinel only',
    tone: 'warn',
    title: 'C 档 · sentinel only：完成能报，但卡住永远不可知 —— 只能写「可能等待输入」',
  },
};

/** 花名册一行的整排 chip（顺序固定：身份 → persona → 通道 → 工作区 → 档位）。 */
export function memberChips(
  member: Pick<MemberStatusView, 'agentId' | 'persona' | 'channel' | 'workspace' | 'tier'>,
): MemberChip[] {
  return [
    { key: 'agent', text: member.agentId, tone: 'default', title: `CLI：${member.agentId}` },
    // persona 只有名字（正文在成员的启动 argv 里，面板不需要）：`null` = 无人设，不渲染。
    member.persona === null
      ? null
      : {
          key: 'persona',
          text: member.persona,
          tone: 'accent',
          title: `角色 persona：${member.persona}（spawn 时注入的人设，与权限无关）`,
        },
    { key: 'channel', ...CHANNEL[member.channel], tone: 'outline' },
    { key: 'workspace', text: workspaceLabel(member.workspace), tone: 'default', title: '工作区' },
    { key: 'tier', ...TIER[member.tier] },
  ].filter((chip): chip is MemberChip => chip !== null);
}
