import { useAgentStore } from '@/shared/store/agentStore';

/**
 * 「这个 agent 用哪个图标」在**团队域**的唯一派生点。
 *
 * # 为什么它不是一个品牌表
 *
 * 图标的真相在数据里：`AgentConfig.icon`（preset 文件名或用户上传的路径），解析与 Tauri
 * 边界归 `features/agent` 的门面（`resolveAgentIconSrc`）。团队侧曾经手抄过一张 Simple
 * Icons 表（只有 claude-code / codex），其余 CLI 一律回退首字母 —— 于是 pi、codebuddy 的
 * 成员在花名册上是「P」「C」，而同一个 agent 在 tab 栏上有完整图标。用户看到的不是风格
 * 差异，是同一件事的两种说法。
 *
 * # 为什么选出一个原始值而不是 agent 对象
 *
 * 返回 `AgentConfig` 会让每行各拿一个新对象（zustand 的相等判定失效），花名册于是在**每次**
 * agent store 变动时全量重画。返回 `string | null` 则只有图标真的变了才重渲染。
 *
 * # 回退仍然存在，但只在真的没有图标时
 *
 * `icon === null`（自定义 agent 允许），或 `agentId` 在配置里不存在（团队引用了已删掉的
 * agent / store 尚未加载）⇒ 调用方回退首字母 + 身份色。两种情况都不是错误，都**不**渲染
 * 一块空白方框（用户分不清「加载失败」与「没有图标」）。
 */
export function useMemberAgentIcon(agentId: string | undefined): string | null {
  return useAgentStore((state) =>
    agentId === undefined
      ? null
      : (state.agents?.find((agent) => agent.id === agentId)?.icon ?? null),
  );
}
