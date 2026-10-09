/**
 * `HtmlPreview` 的 file-changed 订阅：**同文件判定必须走身份抽象**。
 *
 * 原实现是 `p === normalizedFilePath || p.endsWith('/' + normalizedFilePath)`：后者对绝对路径
 * 恒假（`endsWith('//repo/x.html')`），实际只剩字符串等值 —— 事件路径只要有任何词法差异
 * （重复 / 尾斜杠等）就**漏配 ⇒ 预览不刷新、显示过期内容**。同因见任务
 * `09-16-debug-source-identity` 的 `research/identity-audit.md`。
 */
import { render, waitFor } from '@testing-library/react';
import React, { act } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useFileChangedEvent } from '@/shared/hooks/useFileChangedEvent';
import { useProjectStore } from '@/shared/store/projectStore';
import { workspaceKeyOf } from '@/shared/utils/workspaceRef';
import { createProject } from '@/testing/factories';

const readFileContent = vi.hoisted(() => vi.fn());

vi.mock('@/features/file/api/fileApi', () => ({ readFileContent }));
vi.mock('@/shared/hooks/useFileChangedEvent', () => ({ useFileChangedEvent: vi.fn() }));

import HtmlPreview from '../HtmlPreview';

const PROJECT_PATH = '/repo';
const FILE_PATH = `${PROJECT_PATH}/docs/main.html`;
/** 主仓单元与某 linked worktree 单元的 key（由唯一产出点构造，不手拼分隔符）。 */
const MAIN_KEY = workspaceKeyOf('p1', null);
const WT_PATH = '/repo-wt';
const WT_KEY = workspaceKeyOf('p1', WT_PATH);

function grabFileChangedHandler(): (event: { workspace_key: string; paths: string[] }) => void {
  const calls = vi.mocked(useFileChangedEvent).mock.calls;
  const handler = calls[calls.length - 1]?.[0];
  if (!handler) throw new Error('file-changed handler not registered');
  return handler as never;
}

async function renderPreview(projectPath = PROJECT_PATH, filePath = FILE_PATH) {
  useProjectStore.setState({
    activeProjectId: 'p1',
    projects: [createProject({ id: 'p1', path: projectPath })],
  });
  const utils = render(<HtmlPreview projectId="p1" filePath={filePath} fileName="main.html" />);
  // 等首屏读取落地，之后用增量计数断言（waitFor 自带 act 包装，避免空 act）
  await waitFor(() => expect(readFileContent).toHaveBeenCalled());
  return { ...utils, handler: grabFileChangedHandler() };
}

beforeEach(() => {
  vi.clearAllMocks();
  readFileContent.mockResolvedValue({
    path: FILE_PATH,
    content: '<html><head></head><body>hi</body></html>',
    size: 40,
    is_binary: false,
  });
});

describe('HtmlPreview — 变更事件按身份命中本文件', () => {
  it('事件路径为本文件（canonical 形态）→ 重新读取内容', async () => {
    const { handler } = await renderPreview();
    const before = readFileContent.mock.calls.length;

    await act(async () => {
      handler({ workspace_key: MAIN_KEY, paths: ['docs/main.html'] });
    });

    expect(readFileContent.mock.calls.length).toBe(before + 1);
  });

  it('事件路径回退为**绝对路径**（watcher strip_prefix 失败）也必须命中', async () => {
    // 生产者契约（debounce.rs）：`strip_prefix(work_dir).unwrap_or(&abs_path)`
    // —— 工作树根之外的变更以绝对路径下发。两种形态都必须命中，否则预览不刷新。
    const { handler } = await renderPreview();
    const before = readFileContent.mock.calls.length;

    await act(async () => {
      handler({ workspace_key: MAIN_KEY, paths: [FILE_PATH] });
    });

    expect(readFileContent.mock.calls.length).toBe(before + 1);
  });

  it('非规范但等价的形态（重复斜杠）也必须命中：字符串等值会漏配', async () => {
    const { handler } = await renderPreview();
    const before = readFileContent.mock.calls.length;

    await act(async () => {
      handler({ workspace_key: MAIN_KEY, paths: ['docs//main.html'] });
    });

    expect(readFileContent.mock.calls.length).toBe(before + 1);
  });

  it('worktree 单元：事件路径相对**该单元工作树根**（不是项目根）→ 必须命中', async () => {
    // 回归：`paths` 的基准是**产出单元**的工作树根（watcher 挂在单元上，
    // Rust 侧 `strip_prefix(repo.work_dir())`）。若仍以项目根拼相对路径，会落到主仓的
    // `/repo/docs/main.html`，而本预览显示的是 `/repo-wt/docs/main.html` ⇒ 恒漏配、预览不刷新。
    const wtFile = `${WT_PATH}/docs/main.html`;
    const { handler } = await renderPreview(PROJECT_PATH, wtFile);
    const before = readFileContent.mock.calls.length;

    await act(async () => {
      handler({ workspace_key: WT_KEY, paths: ['docs/main.html'] });
    });

    expect(readFileContent.mock.calls.length).toBe(before + 1);
  });

  it('主仓事件不得命中 worktree 单元里的同名相对路径（同形不同义）', async () => {
    const wtFile = `${WT_PATH}/docs/main.html`;
    const { handler } = await renderPreview(PROJECT_PATH, wtFile);
    const before = readFileContent.mock.calls.length;

    await act(async () => {
      handler({ workspace_key: MAIN_KEY, paths: ['docs/main.html'] });
    });

    expect(readFileContent.mock.calls.length).toBe(before);
  });

  it('事件路径为别的文件 → 不重新读取', async () => {
    const { handler } = await renderPreview();
    const before = readFileContent.mock.calls.length;

    await act(async () => {
      handler({ workspace_key: MAIN_KEY, paths: ['docs/other.html'] });
    });

    expect(readFileContent.mock.calls.length).toBe(before);
  });
});
