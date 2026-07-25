import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { createManagedSkill } from '../../../../testing/factories';
import type { SkillItemActions } from '../skillItemTypes';
import SkillListSection from '../SkillListSection';

function makeActions(overrides?: Partial<SkillItemActions>): SkillItemActions {
  return {
    onSelectSkill: vi.fn(),
    onEditSkill: vi.fn(),
    onViewSkill: vi.fn(),
    onDeleteSkill: vi.fn(),
    ...overrides,
  };
}

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
    expect(screen.getByTestId('skill-list-section-skeleton')).toBeInTheDocument();
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

  it('使用卡片网格布局', () => {
    render(
      <SkillListSection
        skills={[createManagedSkill({ id: 's1', name: 'Alpha' })]}
        loading={false}
        selectedSkillId={null}
        actions={makeActions()}
      />,
    );
    expect(screen.getByRole('list')).toBeInTheDocument();
  });

  it('skills 为空时显示 empty state', () => {
    render(
      <SkillListSection
        skills={[]}
        loading={false}
        selectedSkillId={null}
        actions={makeActions()}
      />,
    );
    expect(screen.getByText('No skills yet')).toBeInTheDocument();
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
    fireEvent.click(screen.getByText('My Skill'));
    expect(actions.onSelectSkill).toHaveBeenCalledWith('s1');
  });

  it('已选中的 skill 再次点击传入 null（取消选中）', () => {
    const actions = makeActions();
    const skill = createManagedSkill({ id: 's1', name: 'My Skill' });
    render(
      <SkillListSection skills={[skill]} loading={false} selectedSkillId="s1" actions={actions} />,
    );
    fireEvent.click(screen.getByText('My Skill'));
    expect(actions.onSelectSkill).toHaveBeenCalledWith(null);
  });
});
