import { beforeEach, describe, expect, it } from 'vitest';

import { useGitStore } from '../gitStore';

describe('gitStore — ignoredByProject（文件树灰色显示的装饰输入）', () => {
  beforeEach(() => {
    useGitStore.setState({ ignoredByProject: {} });
  });

  it('初始为空', () => {
    expect(useGitStore.getState().ignoredByProject).toEqual({});
  });

  it('setIgnoredFiles 写入指定项目', () => {
    useGitStore.getState().setIgnoredFiles('p1', ['.env', 'dist']);

    expect(useGitStore.getState().ignoredByProject['p1']).toEqual(['.env', 'dist']);
  });

  it('同长度同内容写入保持引用稳定（避免下游依赖抖动）', () => {
    useGitStore.getState().setIgnoredFiles('p1', ['.env']);
    const first = useGitStore.getState().ignoredByProject['p1'];

    useGitStore.getState().setIgnoredFiles('p1', ['.env']);

    expect(useGitStore.getState().ignoredByProject['p1']).toBe(first);
  });

  it('同长度不同内容则更新', () => {
    useGitStore.getState().setIgnoredFiles('p1', ['.env']);
    const first = useGitStore.getState().ignoredByProject['p1'];

    useGitStore.getState().setIgnoredFiles('p1', ['dist']);

    expect(useGitStore.getState().ignoredByProject['p1']).not.toBe(first);
    expect(useGitStore.getState().ignoredByProject['p1']).toEqual(['dist']);
  });

  it('不同长度则更新', () => {
    useGitStore.getState().setIgnoredFiles('p1', ['.env']);
    useGitStore.getState().setIgnoredFiles('p1', ['.env', 'dist']);

    expect(useGitStore.getState().ignoredByProject['p1']).toEqual(['.env', 'dist']);
  });
});
