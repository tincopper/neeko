import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import ProjectGroup from '@/shared/components/ProjectGroup';

/**
 * 拖拽把手的**范围与键盘契约**。
 *
 * 两条回归钉子：
 *
 * 1. **范围**：整卡可拖时，点会话行 / 工作树行时手一抖就变成「拖动了整个项目」，
 *    卡片被抬起跟手 —— 用户看到的就是「项目块自己飘起来了」。所以 listeners 只落在项目头。
 * 2. **键盘**：把手只接指针监听器，项目头的 Enter/Space 仍然是折叠。
 *    此前 `ProjectGroup` 既展开 `listeners`（含 `KeyboardSensor` 的 `onKeyDown`）又写自己的
 *    `onKeyDown`，后者覆盖前者 —— 声明了键盘拖拽却永远不生效，同时空格键语义被两套约定
 *    争用。现在两边都说真话：键盘拖拽不声明，折叠保留。
 */
describe('ProjectGroup — 拖拽把手范围与键盘契约', () => {
  it('listeners 落在项目头；子内容不在把手覆盖的节点里', () => {
    const onPointerDown = vi.fn();
    render(
      <ProjectGroup
        name="neeko"
        sessionCount={2}
        expanded
        actions={{ onToggle: vi.fn(), onContextMenu: vi.fn() }}
        dragHandleProps={{ onPointerDown }}
      >
        <div>session rows</div>
      </ProjectGroup>,
    );

    const header = screen.getByTestId('project-group-header');
    // 会话行 / 工作树行在 ProjectGroup 的 children 里，**不在**这个把手上。
    expect(header).not.toHaveTextContent('session rows');

    // 指针事件确实接到了项目头上（把手生效）。
    fireEvent.pointerDown(header);
    expect(onPointerDown).toHaveBeenCalledTimes(1);
  });

  it('不传 dragHandleProps 时项目头照常可点（折叠语义不受影响）', () => {
    const onToggle = vi.fn();
    render(
      <ProjectGroup
        name="neeko"
        sessionCount={1}
        expanded
        actions={{ onToggle, onContextMenu: vi.fn() }}
      />,
    );
    fireEvent.click(screen.getByTestId('project-group-header'));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('Enter / Space 是折叠，不是拖拽（把手不注入键盘激活键）', () => {
    const onToggle = vi.fn();
    const onKeyDown = vi.fn();
    render(
      <ProjectGroup
        name="neeko"
        sessionCount={1}
        expanded
        actions={{ onToggle, onContextMenu: vi.fn() }}
        // 真实 `listeners` 不含 `onKeyDown`（键盘激活靠 `attributes`，本项目不传）。
        // 这里故意多传一个，钉住“项目头的折叠处理不被展开顺序顶掉”。
        dragHandleProps={{ onKeyDown }}
      />,
    );

    fireEvent.keyDown(screen.getByTestId('project-group-header'), { key: 'Enter' });
    expect(onToggle).toHaveBeenCalledTimes(1);
    // 展开在 `onKeyDown` 之前，后者胜出 —— 键盘语义只能有一套。
    expect(onKeyDown).not.toHaveBeenCalled();
  });
});
