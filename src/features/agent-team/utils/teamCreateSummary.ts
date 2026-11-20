import type { ApprovalPolicy } from '@/shared/types/team';

import type { LaunchWorkspace } from '../types';

/**
 * 建队 footer 的**实时摘要**：这支队伍按下去之后长什么样，一句话说完。
 *
 * # 为什么是纯函数
 *
 * 它派生自草稿（渲染期算，不进 state），唯一的输入是草稿 + 显示名解析器 —— 没有一跳需要
 * 「记得刷新」。抽出来是因为它的**顺序**与**去重**都是有理由的（见下），而组件里一段内联
 * 三元写不出这两个理由，测试也无处落笔。
 *
 * # 为什么自带输入形状，而不是 import 草稿的 `TeamConfigValues`
 *
 * 摘要只需要**它读到的那几项**。绑上草稿的完整类型会让 `utils/` 反向依赖 `hooks/`
 * （方向反了：hooks 依赖 utils），而且草稿加一个字段（比如 `maxMembers`）就会让本文件
 * 看起来「应该处理它」。结构子集让这里只声明自己的输入，调用方传草稿仍然成立。
 *
 * # 三条口径
 *
 * 1. **名字只在用户填了时出现**：留空 = 后端取工作区目录名，那种情况不在这里重算一份
 *    （前端的第二份判据没有存在的理由 —— 目录名只有后端能从工作区根回答）。
 * 2. **成员段汇总成一行再整体 push**：逐个 push 会让第二个成员之后的名字重复出现在摘要里
 *    （「2 名成员（A / B） · B · …」）。
 * 3. **角色用预设名，不用成员位名**：摘要回答「谁带什么人设」，`A→研究员` 比 `A` 多一个
 *    事实。空勾选时整段不出现（空池在后端是「不限制」，摘要不能把它说成「0 名成员」）。
 */
export interface TeamCreateSummaryInput {
  /** 勾选的成员位（顺序恒为成员池行序）。 */
  selectedIds: string[];
  /** 每个成员位的角色（agentId → persona 名；空串 = 用缺省）。 */
  roleByAgent: Record<string, string>;
  /** 缺省角色名；空串 = 无人设。 */
  persona: string;
  workspace: LaunchWorkspace;
  approvalPolicy: ApprovalPolicy;
}

export function teamCreateSummary(
  values: TeamCreateSummaryInput,
  name: string | null,
  nameOf: (agentId: string) => string,
): string {
  const parts: string[] = [];
  if (name !== null) parts.push(`"${name}"`);

  if (values.selectedIds.length > 0) {
    const staffed = values.selectedIds
      .map((agentId) => {
        const persona = values.roleByAgent[agentId];
        const label = nameOf(agentId);
        return persona ? `${label}→${persona}` : label;
      })
      .join(' / ');
    parts.push(`${values.selectedIds.length} members (${staffed})`);
  }

  if (values.persona) parts.push(`Default persona ${values.persona}`);
  parts.push(values.workspace === 'read_only' ? 'Read-only' : 'Shared workspace');
  parts.push(
    values.approvalPolicy === 'queue'
      ? 'Approval queue'
      : values.approvalPolicy === 'interactive'
        ? 'Interactive approval'
        : 'Bypass approval',
  );
  return parts.join(' · ');
}
