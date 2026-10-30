import { useEffect, useMemo, useState } from 'react';

import type { AgentConfig } from '@/shared/types/agent';

import { chatLaunchSignature, supportsChatResume } from '../utils/chatResumeSupport';

/**
 * 把「哪些 agent 能把原生会话恢复为 Agent Chat」一次算成 `Set`。
 *
 * 一次查询复用给整张列表：入口显隐必须在**容器层**派生（组件不得自行发起 IPC），
 * 而 `ConversationItem` 拿不到 agent 能力 —— 所以由 wrapper 算好、按 `Set` 下传。
 *
 * 依赖用 `[id, 启动签名]` 的序列化投影，而不是 `agents` 数组本身：
 *
 * - `agents` 来自 context，每次渲染可能是新数组身份 —— 直接进依赖会把查询打成每渲染一次；
 * - 反过来，只投影 id 会在用户改完某 agent 的 chat 配置后**不再重查**（入口显隐失真到
 *   重启）。签名里带 `enabled` + `chat`，两个方向才对。
 */
export function useChatResumableAgents(agents: AgentConfig[]): Set<string> {
  const signature = useMemo(
    () => JSON.stringify(agents.map((a) => [a.id, chatLaunchSignature(a)])),
    [agents],
  );
  const [resumable, setResumable] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    const ids = (JSON.parse(signature) as [string, string][]).map(([id]) => id);
    let cancelled = false;

    void (async () => {
      const flags = await Promise.all(ids.map((id) => supportsChatResume(id)));
      if (cancelled) return;
      setResumable(new Set(ids.filter((_, i) => flags[i])));
    })();

    return () => {
      cancelled = true;
    };
  }, [signature]);

  return resumable;
}
