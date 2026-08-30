import { useCallback, useMemo } from 'react';

import { useLspStore } from '@/shared/store/lspStore';
import { useNotificationStore } from '@/shared/store/notificationStore';

import { lspGoToDefinition, lspRequest } from '../api/lspApi';
import type { LspLocation } from '../types';

import { definitionCacheKey, getOrFetchDefinition } from './lspCache';

/**
 * 显式跳转可共享的 pending 年龄上限。双击/F12 通常与刚发出的 hover probe
 * 同位（同 cache key）——共享新鲜 pending 消除双倍 LSP 往返；窗口足够小，
 * 不会等到陈旧文档版本上的旧结果。
 */
const JUMP_PENDING_SHARE_MS = 1000;

function toLspLocation(raw: unknown): LspLocation | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  // LocationLink (rust-analyzer): { targetUri, targetRange, targetSelectionRange }
  if (typeof obj.targetUri === 'string') {
    // Prefer targetSelectionRange (symbol name) over targetRange (full definition)
    const range = (obj.targetSelectionRange || obj.targetRange) as LspLocation['range'] | undefined;
    if (!range) return null;
    return { uri: obj.targetUri, range };
  }
  // Location: { uri, range }
  if (typeof obj.uri === 'string' && obj.range) {
    return { uri: obj.uri, range: obj.range as LspLocation['range'] };
  }
  return null;
}

function unwrapLocation(raw: unknown): LspLocation | null {
  if (Array.isArray(raw)) {
    for (const item of raw) {
      const loc = toLspLocation(item);
      if (loc) return loc;
    }
    return null;
  }
  return toLspLocation(raw);
}

export interface GoToDefinitionWithContentResult {
  location: LspLocation;
  fileContent: string | null;
}

// ── "未找到定义" feedback throttle ───────────────────────────────────
// A failed explicit jump (no definition, or the server returned null/cancelled)
// shows one lightweight info toast per short window, so mashing F12 on a
// non-navigable position cannot spam the notification store.
const NO_DEFINITION_HINT_COOLDOWN_MS = 2000;
let lastNoDefinitionHintAt = 0;

/** @internal test helper — clears the no-definition hint cooldown. */
export function __resetNoDefinitionHintForTests(): void {
  lastNoDefinitionHintAt = 0;
}

function showNoDefinitionHint(): void {
  const now = Date.now();
  if (now - lastNoDefinitionHintAt < NO_DEFINITION_HINT_COOLDOWN_MS) return;
  lastNoDefinitionHintAt = now;
  useNotificationStore.getState().addNotification({
    type: 'info',
    title: 'No Definition Found',
    message: 'No navigable definition at this position.',
  });
}

/**
 * Hook for Go to Definition and Find References.
 */
export function useLspDefinition(projectPath: string | null) {
  const goToDefinitionWithContent = useCallback(
    async (
      languageId: string,
      uri: string,
      line: number,
      character: number,
    ): Promise<GoToDefinitionWithContentResult | null> => {
      if (!projectPath) return null;

      try {
        useLspStore.getState().setDefinitionJumping(true);
        const key = definitionCacheKey(projectPath, uri, line, character);
        // 共享新鲜 pending：跳转手势与 probe 同位时避免双倍请求
        const wrapped = await getOrFetchDefinition(
          key,
          () => lspGoToDefinition(projectPath, languageId, uri, line, character),
          { sharePendingWithinMs: JUMP_PENDING_SHARE_MS },
        );

        if (!wrapped || !wrapped.lspResult) {
          // No definition at this position (or the request was cancelled) —
          // lightweight feedback so an explicit jump is not silently a no-op.
          showNoDefinitionHint();
          return null;
        }
        const location = unwrapLocation(wrapped.lspResult);
        if (!location) {
          showNoDefinitionHint();
          return null;
        }
        return { location, fileContent: wrapped.fileContent ?? null };
      } catch (e) {
        console.error('[LSP] Go to definition (with content) failed:', e);
        useNotificationStore.getState().addNotification({
          type: 'error',
          title: 'Go to Definition Failed',
          message: String(e),
        });
        return null;
      } finally {
        useLspStore.getState().setDefinitionJumping(false);
      }
    },
    [projectPath],
  );

  const findReferences = useCallback(
    async (
      languageId: string,
      uri: string,
      line: number,
      character: number,
    ): Promise<LspLocation[]> => {
      if (!projectPath) return [];

      try {
        const result = await lspRequest(projectPath, languageId, 'textDocument/references', {
          textDocument: { uri },
          position: { line, character },
          context: { includeDeclaration: true },
        });

        if (!result) return [];
        if (!Array.isArray(result)) return [];
        return result.map((item) => toLspLocation(item)).filter(Boolean) as LspLocation[];
      } catch (e) {
        console.error('[LSP] Find references failed:', e);
        useNotificationStore.getState().addNotification({
          type: 'error',
          title: 'Find References Failed',
          message: String(e),
        });
        return [];
      }
    },
    [projectPath],
  );

  return useMemo(
    () => ({ goToDefinitionWithContent, findReferences }),
    [goToDefinitionWithContent, findReferences],
  );
}
