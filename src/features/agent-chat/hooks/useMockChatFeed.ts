import { useEffect } from 'react';

import { useMockEventSchedule, type MockEventScheduleParams } from './useMockEventSchedule';

/**
 * Mock 演示模式的接线（开发 / 演示用）：置 streaming + 回放假 agent loop。
 *
 * 从 `useAgentChat` 抽出——那里的单一职责是**真实**流式编排；mock 只是一种喂事件的方式，
 * 与真实路径共用同一个 `applyEvent` reducer，接线本身没有其它耦合。抽出的另一个理由：
 * `useAgentChat` 贴着组件规模红线（≤300 行 ratchet），把演示路径留在里面会把"真正的逻辑"
 * 挤成超线文件。
 */
export function useMockChatFeed(
  params: MockEventScheduleParams & { setStreaming: (value: boolean) => void },
): void {
  const { setStreaming, ...schedule } = params;

  // Mock 模式启动时标记 streaming
  useEffect(() => {
    if (schedule.mockMode) setStreaming(true);
  }, [schedule.mockMode, setStreaming]);

  // 事件序列与真实流共用 applyEvent reducer
  useMockEventSchedule(schedule);
}
