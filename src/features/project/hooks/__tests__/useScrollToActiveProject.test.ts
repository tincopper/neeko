import { act, render } from '@testing-library/react';
import React, { useRef } from 'react';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { useProjectStore } from '@/shared/store/projectStore';
import type { ProjectId } from '@/shared/utils/workspaceRef';
import { createProject } from '@/testing/factories';

import { useScrollToActiveProject } from '../useScrollToActiveProject';

/**
 * jsdom 没有 scrollIntoView；`src/testing/setup.ts` 已在 `HTMLElement.prototype`
 * 装过替身 —— 这里 spyOn 换成**记录型**替身（原型链上 HTMLElement 比 Element 近，
 * 直接 spy Element 级会被 setup 的替身遮住，替身调用不可见）。
 */
const scrolled: Element[] = [];

// 纯 hook 测试走 .ts（本目录命名约定）：夹具用 createElement，不引入 .tsx 命名约束
function Harness(): React.ReactElement {
  const ref = useRef<HTMLDivElement>(null);
  useScrollToActiveProject(ref);
  return React.createElement(
    'div',
    { ref, 'data-testid': 'container' },
    React.createElement('div', { 'data-project-id': 'p1' }),
    React.createElement('div', { 'data-project-id': 'p2' }),
  );
}

function setActive(id: string) {
  const project = createProject({ id: id as ProjectId, name: id });
  useProjectStore.setState({
    projects: [project],
    activeProjectId: project.id,
    activeProject: project,
  });
}

describe('useScrollToActiveProject（项目切换 → 侧栏跳转）', () => {
  beforeAll(() => {
    vi.spyOn(HTMLElement.prototype, 'scrollIntoView').mockImplementation(function mock(
      this: HTMLElement,
    ) {
      scrolled.push(this);
    });
  });

  afterAll(() => {
    vi.mocked(HTMLElement.prototype.scrollIntoView).mockRestore();
  });

  it('首挂载不跳（初定位归 useScrollMemory 恢复）', () => {
    scrolled.length = 0;
    setActive('p1');
    render(React.createElement(Harness));
    expect(scrolled).toHaveLength(0);
  });

  it('activeProjectId 变化 → 目标项目被滚入视野（block: nearest）', () => {
    scrolled.length = 0;
    setActive('p1');
    render(React.createElement(Harness));
    act(() => setActive('p2'));
    expect(scrolled).toHaveLength(1);
    expect(scrolled[0].getAttribute('data-project-id')).toBe('p2');
  });

  it('activeProjectId 清空（null）不跳', () => {
    scrolled.length = 0;
    setActive('p1');
    render(React.createElement(Harness));
    act(() => {
      useProjectStore.setState({ activeProjectId: null, activeProject: null });
    });
    expect(scrolled).toHaveLength(0);
  });

  it('目标不在容器内（无 data-project-id 节点）安静跳过', () => {
    scrolled.length = 0;
    setActive('p1');
    render(React.createElement(Harness));
    act(() => setActive('missing'));
    expect(scrolled).toHaveLength(0);
  });
});
