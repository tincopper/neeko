/**
 * File extension → LSP language ID mapping.
 *
 * Built-in defaults are always present. Custom servers (from config.lsp)
 * are merged at runtime via `applyBackendExtensionMap` so that opening a
 * matching file routes to the user-defined language server.
 *
 * Prefer {@link resolveLspLanguageId} when opening files so the live backend
 * registry (custom plugins) is authoritative; the local map is a sync cache.
 */

import { canonicalFsPath, fileUriOfPath } from '@/shared/utils/fileRef';
import { LANGUAGE_BY_EXTENSION, extensionOf } from '@/shared/utils/languageRegistry';

import * as lspApi from './lspApi';

/**
 * LSP 同步缓存覆盖的扩展名（**不带点**）。
 *
 * 覆盖范围是 LSP 子系统的产品决定（决定哪些文件会尝试拉起语言服务器）；
 * **语言名**一律取自 `@/shared/utils/languageRegistry`（唯一事实源）。
 * `languageMap.test.ts` 锁定两者不得漂移。
 */
export const LSP_EXTENSIONS: readonly string[] = [
  'rs',
  'py',
  'ts',
  'tsx',
  'js',
  'jsx',
  'go',
  'java',
  'rb',
  'php',
  'c',
  'h',
  'cpp',
  'hpp',
  'cc',
  'cxx',
  'cs',
  'swift',
  'kt',
  'kts',
  'lua',
  'ex',
  'exs',
  'r',
  'sql',
];

const BUILTIN_LSP_LANGUAGE_MAP: Readonly<Record<string, string>> = Object.fromEntries(
  LSP_EXTENSIONS.flatMap((ext) => {
    const language = LANGUAGE_BY_EXTENSION[ext];
    return language ? [[ext, language] as const] : [];
  }),
);

/** Custom overrides (extension without dot → languageId). Later wins. */
let customExtMap: Record<string, string> = {};

export interface LspExtensionMapEntry {
  extension: string;
  languageId: string;
  serverName: string;
  isCustom: boolean;
  /** 客户端单请求超时（ms）——冷启动慢的服务器自行声明；缺省走通用默认。 */
  requestTimeoutMs?: number;
}

/**
 * DTO → 运行时条目的**唯一**映射点。
 *
 * 曾经两处调用各自手写字段列表、都只搬 4 个字段 ⇒ `requestTimeoutMs` 被丢掉 ⇒
 * `lspClientTimeout()` 恒返回 15s（java / rust 声明的 120s 从未生效，jdtls 冷启动与
 * rust-analyzer 首跳 95-98s 必然超时）。消费侧一律调本函数，不得再手拼字段。
 *
 * 参数类型刻意用运行时条目类型：后端 DTO（`lspApiTypes.ts`）与它结构相同，
 * 少字段会在调用点编译失败；多字段由 `languageMap.test.ts` 的 `maps every DTO field`
 * 守着（`Object.keys` 对不上 → 红灯）。
 */
export function toExtensionMapEntry(dto: LspExtensionMapEntry): LspExtensionMapEntry {
  return {
    extension: dto.extension,
    languageId: dto.languageId,
    serverName: dto.serverName,
    isCustom: dto.isCustom,
    requestTimeoutMs: dto.requestTimeoutMs,
  };
}

/**
 * 每语言请求超时（ms）：来自后端插件数据，**不是本文件硬编码的语言知识**。
 *
 * 冷启动慢的服务器（重型 JVM / 全量索引）在 `LspPlugin` 上声明自己的超时；新增同形态
 * 服务器只需声明数据，不得回到「按 languageId 判断」的老路（红线 15）。
 */
const requestTimeoutMsByLanguage = new Map<string, number>();

/**
 * 后端声明的请求超时；未声明返回 `undefined`（调用方回落到通用默认）。
 */
export function lspRequestTimeoutMs(languageId: string): number | undefined {
  return requestTimeoutMsByLanguage.get(languageId);
}

/**
 * Replace custom extension mappings from the backend registry.
 * Built-ins remain; custom entries override on conflict.
 */
export function applyBackendExtensionMap(entries: LspExtensionMapEntry[]): void {
  const next: Record<string, string> = {};
  requestTimeoutMsByLanguage.clear();
  for (const e of entries) {
    const languageId = e.languageId;
    if (typeof e.requestTimeoutMs === 'number' && e.requestTimeoutMs > 0) {
      requestTimeoutMsByLanguage.set(languageId, e.requestTimeoutMs);
    }
    if (!e.isCustom) continue;
    const ext = e.extension.replace(/^\./, '').toLowerCase();
    if (ext) next[ext] = languageId;
  }
  customExtMap = next;
}

/** Apply custom servers from AppConfig without waiting for backend. */
export function applyCustomServersFromConfig(
  servers: Array<{ languageId: string; file_extensions: string[] }>,
): void {
  const next: Record<string, string> = {};
  for (const s of servers) {
    for (const raw of s.file_extensions ?? []) {
      const ext = raw.replace(/^\./, '').toLowerCase();
      if (ext) next[ext] = s.languageId;
    }
  }
  customExtMap = next;
}

export function getLspLanguageId(filePath: string): string | null {
  const ext = extensionOf(filePath);
  if (!ext) return null;
  return customExtMap[ext] ?? BUILTIN_LSP_LANGUAGE_MAP[ext] ?? null;
}

/**
 * Cache a live registry resolution so subsequent synchronous lookups match the backend.
 * Only writes into the custom map (does not mutate built-in defaults).
 */
export function cacheLiveLanguageResolution(filePath: string, languageId: string): void {
  const ext = extensionOf(filePath);
  const lang = languageId.trim();
  if (!ext || !lang) return;
  // Skip if already the effective mapping
  if (getLspLanguageId(filePath) === lang) return;
  customExtMap = { ...customExtMap, [ext]: lang };
}

/**
 * Resolve language id using the live backend registry (custom plugins first).
 * Falls back to the local extension map when the IPC call fails or returns null.
 * Successful live results are cached for subsequent sync lookups.
 */
export async function resolveLspLanguageId(filePath: string): Promise<string | null> {
  try {
    const live = await lspApi.lspResolveLanguage(filePath);
    if (live) {
      cacheLiveLanguageResolution(filePath, live);
      return live;
    }
  } catch {
    // offline / test environment — use local map
  }
  return getLspLanguageId(filePath);
}

/**
 * 本地路径 → LSP 文档 uri（`file://` 形态）。入参 `filePath` 允许相对（对项目根）或绝对，
 * 锚定走 `canonicalFsPath`、形态走 `fileRef.fileUriOfPath` —— 两者都是单一实现，本函数只负责
 * 「LSP 文档场景」这一层契约（虚拟文档 `jdt://` 不走这里，见 `virtualUri`）。
 */
export function toFileUri(projectPath: string, filePath: string): string {
  return fileUriOfPath(canonicalFsPath(projectPath, filePath));
}

export function fromFileUri(uri: string): string {
  const withoutScheme = uri.startsWith('file://') ? uri.slice('file://'.length) : uri;
  return decodeURIComponent(withoutScheme);
}

export function isLspAvailable(extension: string): boolean {
  const ext = extension.replace(/^\./, '').toLowerCase();
  return ext in customExtMap || ext in BUILTIN_LSP_LANGUAGE_MAP;
}
