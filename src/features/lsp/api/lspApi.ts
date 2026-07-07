import { invoke } from '@tauri-apps/api/core';

import type { LspSessionInfo } from '../types';

export function lspRequest(
  projectPath: string,
  languageId: string,
  method: string,
  // biome-ignore lint/suspicious/noExplicitAny: LSP params are dynamic
  params: any,
): Promise<any> {
  return invoke('lsp_request', {
    projectPath,
    languageId,
    method,
    params,
  });
}

export function lspNotification(
  projectPath: string,
  languageId: string,
  method: string,
  // biome-ignore lint/suspicious/noExplicitAny: LSP params are dynamic
  params: any,
): Promise<void> {
  return invoke('lsp_notification', {
    projectPath,
    languageId,
    method,
    params,
  });
}

export function lspOpenDocument(
  projectPath: string,
  languageId: string,
  uri: string,
  text: string,
  version: number,
): Promise<void> {
  return invoke('lsp_open_document', {
    projectPath,
    languageId,
    uri,
    text,
    version,
  });
}

export function lspChangeDocument(
  projectPath: string,
  languageId: string,
  uri: string,
  version: number,
  changes: Array<{
    range?: {
      start: { line: number; character: number };
      end: { line: number; character: number };
    };
    rangeLength?: number;
    text: string;
  }>,
): Promise<void> {
  return invoke('lsp_change_document', {
    projectPath,
    languageId,
    uri,
    version,
    changes,
  });
}

export function lspCloseDocument(
  projectPath: string,
  languageId: string,
  uri: string,
): Promise<void> {
  return invoke('lsp_close_document', {
    projectPath,
    languageId,
    uri,
  });
}

export function lspCloseSession(projectPath: string, languageId: string): Promise<void> {
  return invoke('lsp_close_session', {
    projectPath,
    languageId,
  });
}

export function lspListSessions(): Promise<LspSessionInfo[]> {
  return invoke<LspSessionInfo[]>('lsp_list_sessions');
}

export interface LspGoToDefinitionResult {
  lspResult: unknown;
  fileContent: string | null;
}

export function lspGoToDefinition(
  projectPath: string,
  languageId: string,
  uri: string,
  line: number,
  character: number,
): Promise<LspGoToDefinitionResult | null> {
  return invoke<LspGoToDefinitionResult | null>('lsp_go_to_definition', {
    projectPath,
    languageId,
    uri,
    line,
    character,
  });
}
