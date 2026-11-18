import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useProjectStore } from '@/shared/store/projectStore';
import { useWorkspaceStore } from '@/shared/store/workspaceStore';
import type { ProjectId } from '@/shared/utils/workspaceRef';

import { activateUnit } from '../activateUnit';

/**
 * `activateUnit` —— 侧栏行点击的**唯一判据**（切项目？然后落单元）。
 *
 * 本文件断言的是**顺序**，不是最终状态：在「切换序列恰好同步」的今天，两种顺序都会得到
 * 同样的最终状态，只有顺序断言能钉住「将来有人在序列中间插一个真正的 `await` 也不会退化」。
 * 退化后的症状很隐蔽 —— 单元被清回主仓，表现只是「点了没落到那个工作树」。
 */
const P1 = 'p1' as ProjectId;
const P2 = 'p2' as ProjectId;
const WT_B = '/repo/wt-b';

/** 原始 action（每个用例把它装回去，避免跨用例泄漏）。 */
const originalSetActiveWorkspace = useWorkspaceStore.getState().setActiveWorkspace;

/** 记录「单元落回」的调用序（顺序断言唯一需要的 instrumentation）。 */
function recordUnits(order: string[]): void {
  useWorkspaceStore.setState({
    setActiveWorkspace: (projectId, path, branch) => {
      order.push(`unit:${projectId}@${path ?? 'main'}`);
      originalSetActiveWorkspace(projectId, path, branch);
    },
  });
}

function activePathOf(projectId: ProjectId): string | null | undefined {
  return useWorkspaceStore.getState().byProject[projectId]?.activePath;
}

beforeEach(() => {
  useWorkspaceStore.setState({ byProject: {}, setActiveWorkspace: originalSetActiveWorkspace });
  useProjectStore.setState({ activeProjectId: null, activeProject: null });
});

describe('activateUnit — 跨项目', () => {
  it('先切项目（等它结算），再把单元落回该项目', async () => {
    const order: string[] = [];
    recordUnits(order);
    useProjectStore.setState({ activeProjectId: P1 });
    // 序列内部**至少一个真正的 await**（今天的 `selectProject` 恰好没有 —— 那只是巧合）：
    // 先落单元的实现到这里会记成 `['unit', 'select:p2']`，测试变红。
    const selectProject = vi.fn(async (projectId: ProjectId) => {
      await Promise.resolve();
      order.push(`select:${projectId}`);
      useProjectStore.setState({ activeProjectId: projectId });
    });

    await activateUnit({ selectProject }, P2, WT_B);

    expect(order).toEqual(['select:p2', 'unit:p2@/repo/wt-b']);
    expect(selectProject).toHaveBeenCalledWith(P2);
    expect(useProjectStore.getState().activeProjectId).toBe(P2);
    expect(activePathOf(P2)).toBe(WT_B);
  });

  it('切换序列返回的 Promise 未结算 ⇒ 单元不落（顺序断言，钉住 R4）', async () => {
    const order: string[] = [];
    recordUnits(order);
    useProjectStore.setState({ activeProjectId: P1 });

    let settle!: () => void;
    const selectProject = () => {
      order.push('select');
      return new Promise<void>((resolve) => {
        settle = () => {
          order.push('select-settled');
          useProjectStore.setState({ activeProjectId: P2 });
          resolve();
        };
      });
    };

    const pending = activateUnit({ selectProject }, P2, WT_B);

    // 切换序列在途：单元**还**不能落（序列内部会清空各项目单元，先落 = 自己擦掉自己）
    await Promise.resolve();
    expect(order).toEqual(['select']);
    expect(activePathOf(P2)).toBeUndefined();

    settle();
    await pending;

    expect(order).toEqual(['select', 'select-settled', 'unit:p2@/repo/wt-b']);
    expect(activePathOf(P2)).toBe(WT_B);
  });

  it('切换函数是同步 `void` 实现 ⇒ 同样工作（兼容两形态）', async () => {
    const order: string[] = [];
    recordUnits(order);
    useProjectStore.setState({ activeProjectId: P1 });

    await activateUnit(
      {
        selectProject: (projectId) => {
          order.push(`select:${projectId}`);
          useProjectStore.setState({ activeProjectId: projectId });
        },
      },
      P2,
      WT_B,
    );

    expect(order).toEqual(['select:p2', 'unit:p2@/repo/wt-b']);
    expect(activePathOf(P2)).toBe(WT_B);
  });
});

describe('activateUnit — 已激活的项目不切（R3）', () => {
  it('同项目 ⇒ 零切换，只落单元，且同步落回（同项目点击结果与改造前一致）', () => {
    const order: string[] = [];
    recordUnits(order);
    useProjectStore.setState({ activeProjectId: P2 });
    const selectProject = vi.fn();

    const settled = activateUnit({ selectProject }, P2, WT_B);

    expect(selectProject).not.toHaveBeenCalled();
    // 同步已落：不需要 await 就可见（同项目的点击不引入一个微任务的行为差）
    expect(order).toEqual(['unit:p2@/repo/wt-b']);
    expect(activePathOf(P2)).toBe(WT_B);
    // 返回的仍是 Promise（调用侧统一接续），只是已经结算
    return expect(settled).resolves.toBeUndefined();
  });

  it('同项目同单元 ⇒ 幂等（store 不产生新的激活态对象）', async () => {
    useProjectStore.setState({ activeProjectId: P2 });
    useWorkspaceStore.getState().setActiveWorkspace(P2, WT_B, 'dev');
    const before = useWorkspaceStore.getState().byProject[P2];

    await activateUnit({ selectProject: vi.fn() }, P2, WT_B);

    expect(useWorkspaceStore.getState().byProject[P2]).toBe(before);
  });
});
