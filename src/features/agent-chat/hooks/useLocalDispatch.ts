import { useCallback, useRef } from 'react';

/// Time (ms) before an unacknowledged dispatch triggers the ACK timeout callback.
const LOCAL_DISPATCH_ACK_TIMEOUT_MS = 10_000;
/// Time (ms) before an unacknowledged dispatch triggers the takeover timeout callback.
const LOCAL_DISPATCH_TAKEOVER_TIMEOUT_MS = 60_000;

export interface LocalDispatchOptions {
  /// Called when the server hasn't acknowledged the message within ACK timeout.
  onAckTimeout?: (messageId: string) => void;
  /// Called when the provider hasn't taken over the turn within takeover timeout.
  onTakeoverTimeout?: (messageId: string) => void;
}

export interface LocalDispatch {
  /// Call when the server echoes the user message or the turn changes.
  serverAcknowledged: () => void;
}

/**
 * 本地调度标记 — 乐观更新的可靠性核心。
 *
 * 发送消息后立即乐观插入，同时启动两个超时计时器：
 * - ACK 超时（10s）：服务器未回显用户消息
 * - 接管超时（60s）：Provider 未进入 running 状态
 *
 * 服务器回显后调用 `serverAcknowledged()` 清除所有计时器。
 */
export function useLocalDispatch() {
  const timers = useRef<
    Map<string, { ack: ReturnType<typeof setTimeout>; takeover: ReturnType<typeof setTimeout> }>
  >(new Map());

  const beginLocalDispatch = useCallback(
    (messageId: string, options: LocalDispatchOptions = {}): LocalDispatch => {
      const { onAckTimeout, onTakeoverTimeout } = options;

      const ack = setTimeout(() => {
        onAckTimeout?.(messageId);
      }, LOCAL_DISPATCH_ACK_TIMEOUT_MS);

      const takeover = setTimeout(() => {
        onTakeoverTimeout?.(messageId);
      }, LOCAL_DISPATCH_TAKEOVER_TIMEOUT_MS);

      timers.current.set(messageId, { ack, takeover });

      return {
        serverAcknowledged: () => {
          const t = timers.current.get(messageId);
          if (t) {
            clearTimeout(t.ack);
            clearTimeout(t.takeover);
            timers.current.delete(messageId);
          }
        },
      };
    },
    [],
  );

  return { beginLocalDispatch };
}
