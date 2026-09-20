import { useCallback, useMemo } from 'react';

import { useLspStore } from '@/features/lsp/store/lspStore';
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

/** 完全没东西可跳时的文案（hover 探测也空的那个分支复用同一份）。 */
const NO_DEFINITION_MESSAGE = 'No navigable definition at this position.';

/** hover 结果是否有内容（服务器对 JDK/构件符号常能 hover，definition 却返回空）。 */
function hasHoverContent(result: unknown): boolean {
  if (!result || typeof result !== 'object' || !('contents' in result)) return false;
  const contents = result.contents;
  if (Array.isArray(contents)) return contents.length > 0;
  if (typeof contents === 'string') return contents.trim().length > 0;
  if (contents && typeof contents === 'object') return Object.keys(contents).length > 0;
  return false;
}

/**
 * 空定义兜底：**所有语言同一条路径**——definition 返回空时追加一次 hover 探测，
 * 区分两种情况并给出准确提示：
 *
 * - hover 有内容：服务器认识这个符号却给不出源码位置（典型是源码/构件未附到工程），
 *   不是"此处没有定义"；
 * - hover 也空：确实没有定义。
 *
 * 代价仅落在失败路径的一次额外请求（此处已在说实话与省一次往返之间选了前者）。
 *
 * 过去这条只对 java 生效（`languageId === 'java'` 分支）——那是把「服务器给了符号但
 * 没给源码位置」当成 Java 的私事：任何处在该状态的服务器都需要同样的分辨能力。
 */
async function showNoDefinitionHintWithHoverProbe(
  projectPath: string,
  languageId: string,
  uri: string,
  line: number,
  character: number,
): Promise<void> {
  const now = Date.now();
  if (now - lastNoDefinitionHintAt < NO_DEFINITION_HINT_COOLDOWN_MS) return;
  lastNoDefinitionHintAt = now;

  const hover = await lspRequest(projectPath, languageId, 'textDocument/hover', {
    textDocument: { uri },
    position: { line, character },
  }).catch(() => null);

  useNotificationStore.getState().addNotification({
    type: 'info',
    title: 'No Definition Found',
    message: hasHoverContent(hover)
      ? 'The server resolved this symbol but returned no source location. ' +
        'Sources may not be attached for this project — try rebuilding indexes or attaching sources.'
      : NO_DEFINITION_MESSAGE,
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
          // probe hover so we can tell "server knows the symbol but has no source
          // location" from "nothing to jump to" (language-agnostic fallback).
          await showNoDefinitionHintWithHoverProbe(projectPath, languageId, uri, line, character);
          return null;
        }
        const location = unwrapLocation(wrapped.lspResult);
        if (!location) {
          await showNoDefinitionHintWithHoverProbe(projectPath, languageId, uri, line, character);
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
