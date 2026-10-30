import { useAgentStore } from '@/shared/store/agentStore';
import type { AgentConfig } from '@/shared/types/agent';

import { supportsAgentChatResume } from '../api/agentChatApi';

/**
 * 「这个 agent 能不能把原生会话恢复为 Agent Chat」的**唯一前端入口**。
 *
 * 数据源只有一个：后端 `agent_chat_supports_resume`（它读
 * `AgentAdapter::supports_chat_resume()`）。**禁止**在这里或调用侧另立白名单 /
 * 按 agentId 判断 —— 那会造出第二份事实，与后端漂移后立刻出现「按钮在、点了报错」
 * 的死入口（正是本次要消灭的形态）。
 *
 * # 为什么住 `utils/` 而不是 `api/`
 *
 * `api/` 的职责是「怎么跟后端说话」（`<domain>Api.ts` 只做 invoke 薄封装，
 * 见 `.trellis/spec/frontend/api-layer.md` 原则 4）。本文件多出来的东西是**领域策略**：
 * 缓存、它的失效键（读 `agentStore`）、以及「查不到就隐藏入口」的失败口径 ——
 * 这些与 IPC 传输无关，换掉传输层也照样成立。把它们放进 `api/` 会让「api = 薄封装」
 * 这条判据失效，而给 spec 开一个「capability façade 例外」的口子，等于让下一个人
 * 把策略往 `api/` 里搬。
 *
 * 依赖方向：`utils → api`（取数据）+ `utils → shared/store`（取缓存键）—— 与同类模块
 * `historyRestore.ts`（恢复策略）一致，都是单向。
 */

/**
 * 能力答案的**输入签名**：后端 `adapter_for(agent)` 只由这两项决定
 * （`chat` 存在且 `chat_enabled != false` → 再按 `chat.transport()` 选适配器，
 * 与 `AgentConfig::is_chat_agent()` 逐字对齐）。
 *
 * 缓存必须按它失效：用户在设置里把 pi 的 chat 命令从 `--mode rpc` 改成 `acp`，
 * 能力就从 true 变成 false，而 **agentId 没变**。只按 agentId 缓存会让入口显隐
 * 失真到重启 —— 那又是一份「与真相脱钩的副本」。
 *
 * 未载入（`agents === null`）时返回常量 `unknown`：载入后签名变化，缓存自然失效。
 */
export function chatLaunchSignature(
  agent: Pick<AgentConfig, 'chat' | 'chat_enabled'> | undefined | null,
): string {
  return agent ? JSON.stringify([agent.chat ?? null, agent.chat_enabled ?? null]) : 'unknown';
}

interface CachedCapability {
  /** 查询时该 agent 的启动签名（见 [`chatLaunchSignature`]）。 */
  signature: string;
  answer: Promise<boolean>;
}

/** 每个 agent 只留**一条**（含它当时的签名）：配置一变就整体替换，不会无限增长。 */
const cache = new Map<string, CachedCapability>();

/**
 * 该 agent 是否支持「历史会话 → Agent Chat」。
 *
 * - 空 id 直接 `false`，不发 IPC（列表里可能有历史遗留的空 agentId）；
 * - 失败缓存为 `false`：查不到能力就当不支持（入口隐藏比死入口安全）；
 * - 同一个 agent 在同一份配置下只发一次 IPC。
 *
 * 签名从 `agentStore`（唯一的前端 agent 配置读入口，写操作后 `refresh()`）现取，
 * 而不是由调用方传入：调用方有两处（Conversations 面板与空聊天列表），让它们各自
 * 拼一份签名等于再造一个可能传错的参数。
 */
export function supportsChatResume(agentId: string): Promise<boolean> {
  if (!agentId) return Promise.resolve(false);

  const signature = chatLaunchSignature(useAgentStore.getState().byId(agentId));
  const cached = cache.get(agentId);
  if (cached?.signature === signature) return cached.answer;

  const answer = supportsAgentChatResume(agentId).catch(() => false);
  cache.set(agentId, { signature, answer });
  return answer;
}
