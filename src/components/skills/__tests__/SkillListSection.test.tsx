import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { createManagedSkill } from '../../../testing/factories';
import SkillListSection from '../SkillListSection';
import type { SkillItemActions } from '../skillItemTypes';

// ─── 工厂 ────────────────────────────────────────────────────────────────────

function makeActions(overrides?: Partial<SkillItemActions>): SkillItemActions {
  return {
    onSelectSkill: vi.fn(),
    onEditSkill: vi.fn(),
    onViewSkill: vi.fn(),
    onDeleteSkill: vi.fn(),
    ...overrides,
  };
}

// ─── 测试 ────────────────────────────────────────────────────────────────────

describe('SkillListSection', () => {
  it('loading=true 时渲染 skeleton cards', () => {
    render(
      <SkillListSection
        skills={[]}
        loading={true}
        selectedSkillId={null}
        actions={makeActions()}
      />,
    );
    const skeletons = document.querySelectorAll('.animate-pulse');
    expect(skeletons.length).toBeGreaterThan(0);
  });

  it('loading=true 时 header 不显示计数', () => {
    render(
      <SkillListSection
        skills={[]}
        loading={true}
        selectedSkillId={null}
        actions={makeActions()}
      />,
    );
    expect(screen.getByText('Skills')).toBeInTheDocument();
    expect(screen.queryByText(/Skills \(\d+\)/)).toBeNull();
  });

  it('有 skills 时渲染 skill 名称', () => {
    render(
      <SkillListSection
        skills={[
          createManagedSkill({ id: 's1', name: 'Alpha Skill' }),
          createManagedSkill({ id: 's2', name: 'Beta Skill' }),
        ]}
        loading={false}
        selectedSkillId={null}
        actions={makeActions()}
      />,
    );
    expect(screen.getByText('Alpha Skill')).toBeInTheDocument();
    expect(screen.getByText('Beta Skill')).toBeInTheDocument();
  });

  it('显示 skills 计数', () => {
    render(
      <SkillListSection
        skills={[
          createManagedSkill({ id: 's1', name: 'Alpha' }),
          createManagedSkill({ id: 's2', name: 'Beta' }),
        ]}
        loading={false}
        selectedSkillId={null}
        actions={makeActions()}
      />,
    );
    expect(screen.getByText('Skills (2)')).toBeInTheDocument();
  });

  it('skills 为空时显示 "No skills found"', () => {
    render(
      <SkillListSection
        skills={[]}
        loading={false}
        selectedSkillId={null}
        actions={makeActions()}
      />,
    );
    expect(screen.getByText('No skills found')).toBeInTheDocument();
  });

  it('点击卡片调用 onSelectSkill', () => {
    const actions = makeActions();
    const skill = createManagedSkill({ id: 's1', name: 'My Skill' });
    render(
      <SkillListSection
        skills={[skill]}
        loading={false}
        selectedSkillId={null}
        actions={actions}
      />,
    );
    // 点击卡片本体触发 onSelect → onSelectSkill
    fireEvent.click(screen.getByText('My Skill'));
    expect(actions.onSelectSkill).toHaveBeenCalledWith('s1');
  });

  it('已选中的 skill 再次点击传入 null（取消选中）', () => {
    const actions = makeActions();
    const skill = createManagedSkill({ id: 's1', name: 'My Skill' });
    render(
      <SkillListSection
        skills={[skill]}
        loading={false}
        selectedSkillId="s1"
        actions={actions}
      />,
    );
    fireEvent.click(screen.getByText('My Skill'));
    expect(actions.onSelectSkill).toHaveBeenCalledWith(null);
  });
});
