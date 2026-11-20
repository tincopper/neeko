import React, { useCallback, useState } from 'react';

import { cn } from '@/lib/utils';
import type { LaunchableAgent, RolePreset } from '@/shared/types/team';
import { Input } from '@/ui';

/**
 * 成员池：**每个成员位一个角色下拉**（v20 的 role_hints 就是这里收集的）。
 *
 * # 为什么角色下拉长在成员行上，而不是单独一块
 *
 * 「谁 + 它的人设」是同一个决定 —— 分开两处，用户要对着名字猜角色给到了谁。
 * 行内下拉 + 行内创建卡（pick-or-create：选「＋ 新建角色…」就地展开）把两件事
 * 合成同一个动作；创建卡是**就近 state**（一次建角色动作的中间态，不进 store）。
 *
 * # checkbox 的 accessible name 契约（不变）
 *
 * 名字在 label 内；id / 角色下拉 / 「不可用」在 label 外 —— checkbox 的
 * accessible name 必须只有显示名（测试与读屏都按它点名）。
 */
interface TeamMemberPoolProps {
  members: readonly LaunchableAgent[];
  /** 已勾选且可选角色的成员位角色表（agentId → persona 名；空串 = 用缺省）。 */
  roleByAgent: Record<string, string>;
  selectedIds: readonly string[];
  /** 角色库（下拉的选项源）；`null` = 还没拿到。 */
  roles: RolePreset[] | null;
  /** pick-or-create 的保存回调；`undefined` = 角色库不可用（没有「＋ 新建角色…」入口）。 */
  onCreateRole?: (input: {
    name: string;
    preamble: string;
    cliPreference: string | null;
  }) => Promise<RolePreset | null>;
  onToggleMember: (agentId: string, next: boolean) => void;
  onSetRole: (agentId: string, persona: string) => void;
  nameOf: (agentId: string) => string;
}

const TeamMemberPool: React.FC<TeamMemberPoolProps> = React.memo(
  ({
    members,
    roleByAgent,
    selectedIds,
    roles,
    onCreateRole,
    onToggleMember,
    onSetRole,
    nameOf,
  }) => {
    // pick-or-create 的内联创建卡：正在为哪个成员位建角色（`null` = 关闭）。
    const [creatingFor, setCreatingFor] = useState<string | null>(null);
    const [newName, setNewName] = useState('');
    const [newPreamble, setNewPreamble] = useState('');
    const [newCli, setNewCli] = useState('');
    const [savingRole, setSavingRole] = useState(false);
    const [roleError, setRoleError] = useState<string | null>(null);

    const cancelRoleCreate = useCallback(() => {
      setCreatingFor(null);
      setNewName('');
      setNewPreamble('');
      setNewCli('');
      setRoleError(null);
    }, []);

    const handleCreateRole = useCallback(
      async (agentId: string) => {
        if (!onCreateRole) return;
        const name = newName.trim();
        const preamble = newPreamble.trim();
        // 一眼就非法的只拦非空；长度 / 控制字符的判据在后端保存时（拒绝而非截断）。
        if (name === '' || preamble === '') {
          setRoleError('Role name and persona body are both required.');
          return;
        }
        setSavingRole(true);
        setRoleError(null);
        try {
          const saved = await onCreateRole({
            name,
            preamble,
            cliPreference: newCli === '' ? null : newCli,
          });
          if (saved) {
            onSetRole(agentId, saved.name);
            cancelRoleCreate();
          }
        } catch (err: unknown) {
          // 保存失败的原因原样显示在卡里（后端判据的原文 —— 改写会丢信息）。
          setRoleError(err instanceof Error ? err.message : String(err));
        } finally {
          setSavingRole(false);
        }
      },
      [onCreateRole, newName, newPreamble, newCli, onSetRole, cancelRoleCreate],
    );

    return (
      <ul aria-label="Member pool" className="flex flex-col gap-1">
        {members.map((row) => {
          const launchable = row.refusal === null;
          const checked = launchable && selectedIds.includes(row.agentId);
          return (
            <li
              key={row.agentId}
              className={cn(
                'flex flex-col gap-0.5 rounded-md border px-2 py-1.5 transition-colors',
                launchable ? 'border-border bg-bg-primary' : 'border-border/60 bg-bg-secondary',
              )}
            >
              <div className="flex items-center gap-2">
                <label
                  className={cn(
                    'flex min-w-0 flex-1 cursor-pointer items-center gap-2',
                    launchable ? 'text-text-primary' : 'cursor-not-allowed text-text-muted',
                  )}
                >
                  <input
                    type="checkbox"
                    className="size-3.5 shrink-0 accent-[var(--accent-blue,#4a9eff)] disabled:cursor-not-allowed"
                    checked={checked}
                    disabled={!launchable}
                    onChange={(e) => onToggleMember(row.agentId, e.target.checked)}
                  />
                  {/* 名字在 label 内；id 与「不可用」在 label 外 —— checkbox 的
                                accessible name 必须只有显示名（测试与读屏都按它点名）。 */}
                  <span className="truncate text-meta">{nameOf(row.agentId)}</span>
                </label>
                <span className="shrink-0 font-mono text-micro text-text-muted">{row.agentId}</span>
                {row.refusal ? (
                  <span className="shrink-0 rounded bg-bg-tertiary px-1 text-micro text-text-muted">
                    Unavailable
                  </span>
                ) : null}
              </div>
              {checked ? (
                <div className="pl-5">
                  <select
                    aria-label={`${nameOf(row.agentId)}'s role`}
                    className="w-full rounded-md border border-border bg-bg-tertiary px-2 py-1 text-micro text-text-secondary focus-visible:ring-2 focus-visible:ring-accent-blue focus-visible:outline-none"
                    value={roleByAgent[row.agentId] ?? ''}
                    onChange={(e) => {
                      if (e.target.value === '__new__') {
                        setCreatingFor(row.agentId);
                      } else {
                        cancelRoleCreate();
                        onSetRole(row.agentId, e.target.value);
                      }
                    }}
                  >
                    <option value="">No persona (use default)</option>
                    {(roles ?? []).map((role) => (
                      <option key={role.name} value={role.name}>
                        {role.name}
                      </option>
                    ))}
                    {onCreateRole ? <option value="__new__">＋ New role…</option> : null}
                  </select>
                  {creatingFor === row.agentId ? (
                    <div className="mt-1 flex flex-col gap-1.5 rounded-md border border-accent-blue bg-bg-primary p-2">
                      <span className="text-micro font-semibold text-accent-blue">
                        New role (saved to the role library and assigned to {nameOf(row.agentId)})
                      </span>
                      <Input
                        size="sm"
                        value={newName}
                        placeholder="Role name (e.g. Architect)"
                        aria-label="New role name"
                        onChange={(e) => setNewName(e.target.value)}
                      />
                      <Input
                        size="sm"
                        value={newPreamble}
                        placeholder="Persona body (English; goes into member launch args)"
                        aria-label="Persona body"
                        onChange={(e) => setNewPreamble(e.target.value)}
                      />
                      <select
                        value={newCli}
                        aria-label="CLI preference"
                        onChange={(e) => setNewCli(e.target.value)}
                        className="rounded-md border border-border bg-bg-primary px-2 py-1 text-micro text-text-primary focus-visible:ring-2 focus-visible:ring-accent-blue focus-visible:outline-none"
                      >
                        <option value="">CLI preference: none</option>
                        {members
                          .filter((m) => m.refusal === null)
                          .map((m) => (
                            <option key={m.agentId} value={m.agentId}>
                              {nameOf(m.agentId)}
                            </option>
                          ))}
                      </select>
                      {roleError ? <p className="text-micro text-accent-red">{roleError}</p> : null}
                      <div className="flex gap-1.5">
                        <button
                          type="button"
                          disabled={savingRole}
                          onClick={() => handleCreateRole(row.agentId)}
                          className={cn(
                            'rounded-md bg-accent-blue px-2 py-1 text-micro font-semibold',
                            'text-text-on-accent hover:brightness-110',
                            'focus-visible:ring-2 focus-visible:ring-accent-blue focus-visible:outline-none',
                            'disabled:cursor-not-allowed disabled:bg-bg-tertiary disabled:text-text-muted',
                          )}
                        >
                          {savingRole ? 'Saving…' : 'Save and assign'}
                        </button>
                        <button
                          type="button"
                          onClick={cancelRoleCreate}
                          className={cn(
                            'rounded-md border border-border bg-bg-secondary px-2 py-1 text-micro',
                            'text-text-secondary hover:bg-bg-hover',
                            'focus-visible:ring-2 focus-visible:ring-accent-blue focus-visible:outline-none',
                          )}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : null}
              {/* 理由不在这里展开（用户裁决：错误不占页面）—— 它统一收在
                            队长选择区底部的那条折叠行里；这里只给「不可用」这个事实。 */}
            </li>
          );
        })}
      </ul>
    );
  },
);
TeamMemberPool.displayName = 'TeamMemberPool';

export default TeamMemberPool;
