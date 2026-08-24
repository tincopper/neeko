import { useCallback, useRef, useState } from 'react';

export interface QueuedMessage {
  id: string;
  text: string;
  status: 'queued';
}

/**
 * Queue 模式 —— Agent 运行时用户继续输入，消息排队等待当前 turn 结束后自动发送。
 *
 * 用户在 agent 处理中继续输入 → 消息进入队列 → 当前 turn 结束后自动消费下一条。
 * 队列状态按 hook 实例隔离（每 tab 一个实例），无需外部 session 标识。
 */
export function useCommandQueue() {
  const [queue, setQueue] = useState<QueuedMessage[]>([]);
  const idCounter = useRef(0);

  const enqueue = useCallback((text: string) => {
    idCounter.current += 1;
    const id = `q-${idCounter.current}`;
    setQueue((prev) => [...prev, { id, text, status: 'queued' }]);
  }, []);

  return { queue, enqueue };
}
