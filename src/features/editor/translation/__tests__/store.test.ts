import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import type { SourceBlock } from '../../translation/blocks';
import { hashSource, useTranslationStore } from '../store';

const block = (id: string, text: string): SourceBlock => ({ id, kind: 'paragraph', text });

const selectors = {
  targetLanguage: '简体中文',
  agentId: 'opencode',
  modelId: null,
};

describe('useTranslationStore — tab 维度状态机', () => {
  beforeEach(() => {
    useTranslationStore.getState().clear('tab1');
    useTranslationStore.getState().clear('tab2');
  });

  it('initSelectors → idle 条目；不覆盖已存在条目；clear 后回到无状态', () => {
    const { result } = renderHook(() => useTranslationStore());
    act(() => result.current.initSelectors('tab1', selectors));

    expect(result.current.byTab.tab1?.phase).toBe('idle');
    expect(result.current.byTab.tab1?.agentId).toBe('opencode');

    // 已存在 → 不覆盖用户选择
    act(() =>
      result.current.initSelectors('tab1', {
        targetLanguage: 'English',
        agentId: 'other',
        modelId: 'm1',
      }),
    );
    expect(result.current.byTab.tab1?.targetLanguage).toBe('简体中文');

    act(() => result.current.clear('tab1'));
    expect(result.current.byTab.tab1).toBeUndefined();
  });

  it('start → running 快照；setTranslations 回填并从 failedIds 摘除（重试成功路径）', () => {
    const { result } = renderHook(() => useTranslationStore());
    act(() => result.current.initSelectors('tab1', selectors));
    act(() => result.current.start('tab1', { source: '# doc', blocks: [block('b0', 'doc')] }));

    expect(result.current.byTab.tab1?.phase).toBe('running');
    expect(result.current.byTab.tab1?.source).toBe('# doc');

    act(() => result.current.setFailed('tab1', ['b0', 'b1']));
    act(() => result.current.setTranslations('tab1', { b0: '好' }));

    expect(result.current.byTab.tab1?.translations).toEqual({ b0: '好' });
    expect(result.current.byTab.tab1?.failedIds).toEqual(['b1']);
  });

  it('setFailed 幂等去重', () => {
    const { result } = renderHook(() => useTranslationStore());
    act(() => result.current.initSelectors('tab1', selectors));
    act(() => result.current.start('tab1', { source: 'x', blocks: [] }));
    act(() => result.current.setFailed('tab1', ['b0']));
    act(() => result.current.setFailed('tab1', ['b0', 'b1']));

    expect(result.current.byTab.tab1?.failedIds).toEqual(['b0', 'b1']);
  });

  it('markStale 标过期；idle（未翻译）不标', () => {
    const { result } = renderHook(() => useTranslationStore());
    act(() => result.current.initSelectors('tab1', selectors));
    act(() => result.current.start('tab1', { source: 'x', blocks: [] }));
    act(() => result.current.setPhase('tab1', 'done'));
    act(() => result.current.markStale('tab1'));

    expect(result.current.byTab.tab1?.phase).toBe('stale');

    // 未翻译条目不标 stale
    act(() => result.current.initSelectors('tab2', selectors));
    act(() => result.current.markStale('tab2'));
    expect(result.current.byTab.tab2?.phase).toBe('idle');
  });

  it('setPhase 驱动 running → done；不存在的 tab 操作为 no-op', () => {
    const { result } = renderHook(() => useTranslationStore());
    act(() => result.current.initSelectors('tab1', selectors));
    act(() => result.current.start('tab1', { source: 'x', blocks: [] }));
    act(() => result.current.setPhase('tab1', 'done'));
    expect(result.current.byTab.tab1?.phase).toBe('done');

    act(() => result.current.setPhase('tab2', 'done'));
    expect(result.current.byTab.tab2).toBeUndefined();
  });

  it('hashSource 稳定且对内容敏感', () => {
    expect(hashSource('abc')).toBe(hashSource('abc'));
    expect(hashSource('abc')).not.toBe(hashSource('abd'));
    expect(hashSource('')).toBe((5381 >>> 0).toString(36)); // djb2 空串初值
  });

  it('markStale 幂等：重复调用不产生新引用（防订阅方 effect 无限循环）', () => {
    const { result } = renderHook(() => useTranslationStore());
    act(() => result.current.initSelectors('tab1', selectors));
    act(() => result.current.start('tab1', { source: 'x', blocks: [] }));
    act(() => result.current.setPhase('tab1', 'done'));

    act(() => result.current.markStale('tab1'));
    const afterFirst = result.current.byTab.tab1;
    act(() => result.current.markStale('tab1'));

    expect(result.current.byTab.tab1).toBe(afterFirst);
  });

  it('setPhase 同值短路、setFailed 无新增短路（引用不变）', () => {
    const { result } = renderHook(() => useTranslationStore());
    act(() => result.current.initSelectors('tab1', selectors));
    act(() => result.current.start('tab1', { source: 'x', blocks: [] }));
    act(() => result.current.setPhase('tab1', 'done'));
    const snapshotAt = () => result.current.byTab.tab1;

    act(() => result.current.setPhase('tab1', 'done'));
    expect(snapshotAt().phase).toBe('done');

    act(() => result.current.setFailed('tab1', ['b0']));
    const afterFail = snapshotAt();
    act(() => result.current.setFailed('tab1', ['b0']));
    expect(snapshotAt()).toBe(afterFail);
  });
});
