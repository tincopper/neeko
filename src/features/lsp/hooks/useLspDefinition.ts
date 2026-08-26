import { useCallback, useMemo } from 'react';

import { useNotificationStore } from '@/shared/store/notificationStore';

import { lspGoToDefinition, lspRequest } from '../api/lspApi';
import type { LspLocation } from '../types';

import { definitionCacheKey, getOrFetchDefinition } from './lspCache';

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
    title: '未找到定义',
    message: '未获取到可跳转的定义位置。',
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
        const key = definitionCacheKey(projectPath, uri, line, character);
        // skipPending: an explicit jump wants a fresh result for the user's
        // gesture — it must not wait on a best-effort hover probe's pending
        // promise (which may target an older document version).
        const wrapped = await getOrFetchDefinition(
          key,
          () => lspGoToDefinition(projectPath, languageId, uri, line, character),
          { skipPending: true },
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
