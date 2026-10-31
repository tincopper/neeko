import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { StreamEvent } from '@/shared/types/agentChat';

import { useSessionLevelEvents } from '../useSessionLevelEvents';

function setup() {
  const onContextInit = vi.fn();
  const flushDeltas = vi.fn();
  const setStreaming = vi.fn();
  /** 收 updater 函数的 mock：断言时对空数组求值即可看到要追加的消息。 */
  const setMessages = vi.fn();
  const { result } = renderHook(() =>
    useSessionLevelEvents({ onContextInit, flushDeltas, setStreaming, setMessages }),
  );
  return { result, onContextInit, flushDeltas, setStreaming, setMessages };
}

/**
 * 会话级事件（跨话轮存活的状态）。
 *
 * 最关键的一条是 **`should not claim events it does not own`**：调用方的
 * `if (sub.handle(ev)) return;` 会把返回 `true` 的事件当成已处理。对未识别事件
 * 也返回 `true` 会静默吞掉 `session_start` / `config_option_update` / 话轮事件 ——
 * 表现是「模型列表空、用量表不更新」，且没有任何报错。
 */
describe('useSessionLevelEvents', () => {
  it('should claim the context_init event and report the working directory', () => {
    const { result, onContextInit } = setup();
    let claimed = false;
    act(() => {
      claimed = result.current.handle({
        type: 'context_init',
        session_id: 's1',
        cwd: '/proj',
        project_name: 'neeko',
        env: 'local',
        workspace_key: 'p1\u0000',
      } as StreamEvent);
    });
    expect(claimed).toBe(true);
    expect(onContextInit).toHaveBeenCalledWith({
      projectName: 'neeko',
      env: 'local',
      cwd: '/proj',
      workspaceKey: 'p1\u0000',
    });
  });

  it('should hold the pending user input until it is answered', () => {
    const { result } = setup();
    act(() => {
      result.current.handle({
        type: 'user_input',
        session_id: 's1',
        turn_id: 't1',
        prompt: 'Which file?',
        options: ['a.ts', 'b.ts'],
      } as StreamEvent);
    });
    expect(result.current.state.pendingUserInput).toEqual({
      turnId: 't1',
      prompt: 'Which file?',
      options: ['a.ts', 'b.ts'],
    });
  });

  it('should keep the proposed plan across turns', () => {
    const { result } = setup();
    act(() => {
      result.current.handle({
        type: 'proposed_plan',
        session_id: 's1',
        plan: 'step 1',
      } as StreamEvent);
    });
    expect(result.current.state.proposedPlan).toBe('step 1');
  });

  it('should update the context meter from the meta event', () => {
    const { result } = setup();
    act(() => {
      result.current.handle({
        type: 'meta',
        session_id: 's1',
        model: 'pi-model',
        usage: { input_tokens: 100, output_tokens: 20, context_limit: 1_000 },
      } as StreamEvent);
    });
    expect(result.current.state.contextWindow).toEqual({
      used: 100, // context_tokens 缺失 → 回退累计 input
      limit: 1000,
      model: 'pi-model',
    });
  });

  it('should flush the pending deltas before reporting an error', () => {
    const { result, flushDeltas, setStreaming, setMessages } = setup();
    act(() => {
      result.current.handle({
        type: 'error',
        session_id: 's1',
        message: 'boom',
        code: 'E_BOOM',
      } as StreamEvent);
    });
    expect(flushDeltas).toHaveBeenCalled();
    expect(setStreaming).toHaveBeenCalledWith(false);
    // 系统消息在本 hook 内追加（唯一消费者），以 updater 形式落 state。
    expect(setMessages).toHaveBeenCalledTimes(1);
    const updater = setMessages.mock.calls[0][0] as (
      prev: { id: string; role: string }[],
    ) => { id: string; role: string; blocks: unknown }[];
    const next = updater([]);
    expect(next).toHaveLength(1);
    expect(next[0].role).toBe('system');
  });

  it.each([
    'session_start',
    'config_option_update',
    'turn_start',
    'turn_end',
    'text_delta',
    'tool_call',
    'request_approval',
  ])('should not claim the %s event it does not own', (type) => {
    const { result } = setup();
    let claimed = true;
    act(() => {
      claimed = result.current.handle({ type } as StreamEvent);
    });
    expect(claimed).toBe(false);
  });

  /**
   * **`handle` 必须是稳定引用，且不得随会话级状态变化而变。**
   *
   * 事故链（§15，`meta` 每个话轮都发）：
   *
   * ```
   * meta → contextWindow 变 → 返回对象新身份（state 进了 useMemo 依赖）
   *   → useAgentChat 的 applyEvent 依赖它 → listen 的 effect 依赖 applyEvent
   *   → 每次话轮都 unlisten + listen → 最早到达的事件落进拆装窗口 → 收不到握手
   * ```
   *
   * 所以判据是「**状态变化后 `handle` 身份不变**」，而不是「源码里出现了
   * useMemo」—— 后者在被写坏的版本里也成立。
   *
   * 变异验证：把 `handle` 重新塞回带 state 依赖的 useMemo → 本用例变红。
   */
  it('should keep handle identity stable across state changes', () => {
    const { result } = setup();
    const before = result.current.handle;

    act(() => {
      result.current.handle({
        type: 'meta',
        session_id: 's1',
        model: 'm',
        usage: { input_tokens: 1, output_tokens: 1 },
      } as StreamEvent);
    });

    expect(result.current.handle).toBe(before);
  });

  /**
   * `state` 快照**允许**换（它携带值），但调用方不得把它放进依赖数组 ——
   * 这条断言只是把「它会变」写下来，防止有人把两句重新合并。
   */
  it('should hand out a fresh state snapshot after a state change', () => {
    const { result } = setup();
    const before = result.current.state;

    act(() => {
      result.current.handle({
        type: 'proposed_plan',
        session_id: 's1',
        plan: 'p',
      } as StreamEvent);
    });

    expect(result.current.state).not.toBe(before);
    expect(result.current.state.proposedPlan).toBe('p');
  });
});
