// @vitest-environment node
/**
 * AI 动作注册表（镜像 editorViews 的注册表模式）：诊断 UI（Problems 面板 / 编辑器内
 * hover popup）按 **LSP document uri** 找到目标编辑器页的 AI 派发入口。
 *
 * 身份一律走 `FileRef`（红线 12）：登记侧用 tab 身份，解析侧 `fileRefFromLspUri(uri)`
 * 得到同一身份 —— 不自造字符串归一。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { fileRefFromLspUri, tabIdentityOf } from '@/shared/utils/fileRef';

import {
  registerAiActionHandler,
  runAiActionForUri,
  unregisterAiActionHandler,
} from '../aiActionRegistry';

const URI = 'file:///proj/src/main.go';
const IDENTITY = tabIdentityOf(fileRefFromLspUri(URI)!);

const REQ = {
  action: 'fix' as const,
  startLine: 4,
  endLine: 4,
  diagnosticMessage: 'undefined: fmt',
};

describe('aiActionRegistry', () => {
  beforeEach(() => {
    unregisterAiActionHandler(IDENTITY);
  });

  it('按 LSP uri 解析身份并调用已登记的 handler（原样透传请求）', () => {
    const handler = vi.fn(() => true);
    registerAiActionHandler(IDENTITY, handler);

    expect(runAiActionForUri(URI, REQ)).toBe(true);
    expect(handler).toHaveBeenCalledWith(REQ);
  });

  it('handler 返回 false（无 agent 接收）时透传 false', () => {
    registerAiActionHandler(IDENTITY, () => false);

    expect(runAiActionForUri(URI, REQ)).toBe(false);
  });

  it('未登记的身份返回 false（调用方按"没落地"处理）', () => {
    expect(runAiActionForUri(URI, REQ)).toBe(false);
  });

  it('非文件形态的 uri 解析不出 FileRef → false', () => {
    registerAiActionHandler(IDENTITY, () => true);

    expect(runAiActionForUri('untitled:Untitled-1', REQ)).toBe(false);
  });

  it('注销后不再派发（编辑器页关闭即摘除）', () => {
    const handler = vi.fn(() => true);
    registerAiActionHandler(IDENTITY, handler);
    unregisterAiActionHandler(IDENTITY);

    expect(runAiActionForUri(URI, REQ)).toBe(false);
    expect(handler).not.toHaveBeenCalled();
  });

  it('F3 · 同文件双 tab：注销一个仍可派发；全部注销才返回 false', () => {
    const first = vi.fn(() => true);
    const second = vi.fn(() => true);
    registerAiActionHandler(IDENTITY, first);
    registerAiActionHandler(IDENTITY, second);

    unregisterAiActionHandler(IDENTITY);
    expect(runAiActionForUri(URI, REQ)).toBe(true);

    unregisterAiActionHandler(IDENTITY);
    expect(runAiActionForUri(URI, REQ)).toBe(false);
  });
});
