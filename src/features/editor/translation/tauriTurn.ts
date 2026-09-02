import { listen, type UnlistenFn } from '@tauri-apps/api/event';

import { TRANSLATION_EVENT } from '@/shared/events';
import type { SequencedEvent } from '@/shared/types/agentChat';

import { cancelTranslation, startTranslation } from '../api/translationApi';

import type { AbortSignalLike, TranslationTurn } from './pipeline';

export interface TauriTurnOptions {
  agentId: string;
  projectId: string;
  modelId?: string | null;
  /** turn 失败/中止时的错误信息挂载点（可观测） */
  onError?: (message: string) => void;
}

/**
 * 生产 TranslationTurn：`translation_stream` 发起 → 缓冲 `translation://event`
 * 的 TextDelta → `turn_end(completed)` resolve 全文；turn 失败 / `error` /
 * 信号中止（自动 cancel 会话）reject。批次失败由管线统一标记重试。
 */
export function createTauriTurn(options: TauriTurnOptions): TranslationTurn {
  return {
    async run(prompt: string, signal: AbortSignalLike): Promise<string> {
      const sessionId = await startTranslation({
        agentId: options.agentId,
        projectId: options.projectId,
        prompt,
        modelId: options.modelId ?? undefined,
      });

      return new Promise<string>((resolve, reject) => {
        let buffer = '';
        let unlisten: UnlistenFn | null = null;
        let settled = false;
        let abortTimer: ReturnType<typeof setInterval> | null = null;

        const cleanup = () => {
          unlisten?.();
          unlisten = null;
          if (abortTimer !== null) {
            clearInterval(abortTimer);
            abortTimer = null;
          }
        };
        const settle = (fn: () => void) => {
          if (settled) return;
          settled = true;
          cleanup();
          fn();
        };

        listen<SequencedEvent[] | SequencedEvent>(TRANSLATION_EVENT, (event) => {
          const evs = Array.isArray(event.payload) ? event.payload : [event.payload];
          for (const seqEv of evs) {
            if (seqEv.session_id !== sessionId || settled) continue;
            switch (seqEv.type) {
              case 'text_delta':
                buffer += seqEv.delta;
                break;
              case 'turn_end':
                if (seqEv.reason === 'completed') {
                  settle(() => resolve(buffer));
                } else {
                  options.onError?.(`translation turn ${seqEv.reason}`);
                  settle(() => reject(new Error(`translation turn ${seqEv.reason}`)));
                }
                break;
              case 'error':
                options.onError?.(seqEv.message);
                settle(() => reject(new Error(seqEv.message)));
                break;
              default:
                break;
            }
          }
        })
          .then((u) => {
            if (settled) {
              u();
              return;
            }
            unlisten = u;
            // 信号中止：取消会话（bridge 回 turn_end(stopped) 后走 reject；
            // 轮询兜底覆盖事件未达的窗口）
            abortTimer = setInterval(() => {
              if (!signal.aborted || settled) return;
              settle(() => reject(new Error('translation aborted')));
              void cancelTranslation(sessionId).catch(() => {});
            }, 200);
            if (signal.aborted) {
              settle(() => reject(new Error('translation aborted')));
              void cancelTranslation(sessionId).catch(() => {});
            }
          })
          .catch((err) =>
            settle(() => reject(err instanceof Error ? err : new Error(String(err)))),
          );
      });
    },
  };
}
