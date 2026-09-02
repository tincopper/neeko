import { afterEach, describe, expect, it } from 'vitest';

import { useEditorStore } from '@/shared/store/editorStore';
import type { Tab } from '@/shared/types/tab';

import { splitMarkdownBlocks } from '../blocks';
import {
  registerAbortController,
  translationKeyFor,
  translationTabCleanupHandler,
  unregisterAbortController,
} from '../cleanup';
import { useTranslationStore } from '../store';

const makeFileTab = (projectId: string, filePath: string): Tab => ({
  id: `file:${filePath}`,
  projectId,
  title: filePath,
  order: 0,
  data: {
    kind: 'file',
    filePath,
    fileName: filePath,
    content: { path: filePath, content: '', size: 0, is_binary: false },
    isDirty: false,
  },
});

const key = translationKeyFor('p1', 'README.md');

afterEach(() => {
  useTranslationStore.getState().clear(key);
});

describe('translationTabCleanupHandler — 文件 tab 关闭回收', () => {
  it('translationKeyFor 按项目 + 文件路径隔离', () => {
    expect(translationKeyFor('p1', 'a.md')).toBe('p1:a.md');
    expect(translationKeyFor('p1', 'a.md')).not.toBe(translationKeyFor('p2', 'a.md'));
  });

  it('关闭文件 tab → 清除该文件的翻译状态', () => {
    useTranslationStore
      .getState()
      .initSelectors(key, { targetLanguage: '简体中文', agentId: 'opencode', modelId: null });
    useTranslationStore
      .getState()
      .start(key, { source: 'hello', blocks: splitMarkdownBlocks('hello') });
    expect(useTranslationStore.getState().byTab[key]).toBeDefined();

    translationTabCleanupHandler('proj-tab-space', makeFileTab('p1', 'README.md'));

    expect(useTranslationStore.getState().byTab[key]).toBeUndefined();
  });

  it('关闭文件 tab → 中止进行中的翻译（AbortController 触发 abort）', () => {
    const controller = new AbortController();
    registerAbortController(key, controller);
    expect(controller.signal.aborted).toBe(false);

    translationTabCleanupHandler('proj-tab-space', makeFileTab('p1', 'README.md'));

    expect(controller.signal.aborted).toBe(true);
    // 已注销：重复清理不重复 abort 其他资源
    unregisterAbortController(key, controller);
  });

  it('其他 kind 的 tab 清理不受影响（kind 守卫）', () => {
    useTranslationStore
      .getState()
      .initSelectors(key, { targetLanguage: '简体中文', agentId: 'opencode', modelId: null });
    const terminalTab = {
      id: 'term:1',
      projectId: 'p1',
      title: 'Terminal 1',
      order: 0,
      data: { kind: 'terminal' as const, agentId: null, status: 'Idle' as const },
    };

    translationTabCleanupHandler('proj-tab-space', terminalTab);

    expect(useTranslationStore.getState().byTab[key]).toBeDefined();
  });
});

describe('editorStore 注册 — closeTab 触发文件清理', () => {
  it('closeTab 走 tab cleanup 注册表并回收翻译状态', () => {
    // 准备：在项目 tab 空间放置一个文件 tab
    const projKey = 'proj-x';
    // 直接构造：手工塞入 tabs + layout
    useEditorStore.setState((s) => ({
      tabs: {
        ...s.tabs,
        [projKey]: {
          tabs: [makeFileTab('p1', 'README.md')],
          activeTabId: 'file:README.md',
        },
      },
      editorLayout: {
        ...s.editorLayout,
        [projKey]: {
          isSplit: false,
          ratio: 0.5,
          activeGroupId: 'left',
          groups: {
            left: { tabIds: ['file:README.md'], activeTabId: 'file:README.md' },
            right: { tabIds: [], activeTabId: null },
          },
          pinnedTabIds: [],
          pinnedActiveTabId: null,
        },
      },
    }));

    useTranslationStore
      .getState()
      .initSelectors(key, { targetLanguage: '简体中文', agentId: 'opencode', modelId: null });
    useTranslationStore
      .getState()
      .start(key, { source: 'hello', blocks: splitMarkdownBlocks('hello') });

    useEditorStore.getState().closeTab(projKey, 'file:README.md');

    expect(useTranslationStore.getState().byTab[key]).toBeUndefined();
  });
});
