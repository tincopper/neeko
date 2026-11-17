import React, { useCallback, useState } from 'react';

import { cn } from '@/lib/utils';
import type { RolePreset } from '@/shared/types/team';
import { Input } from '@/ui';

import type { TeamRolesState } from '../hooks/useTeamRoles';

import ErrorNotice from './ErrorNotice';

/**
 * 角色库管理区（建队面板）：persona 预设的**全局**清单 + 新增 + 删除。
 *
 * # persona 是什么、不是什么
 *
 * persona =「这个成员怎么干活」的文本包（人设 preamble + CLI 建议），spawn 时作为快照
 * 落到成员行并拼进成员的启动 argv。它与授权（lead/worker）**严格无关**：persona 永远
 * 不能改变授权判定，所以这里只是一个数据编辑器，没有任何「角色 → 权限」的语义。
 *
 * # 编辑 = 同名保存
 *
 * 角色名是主键：同名校 = 覆盖所有列（后端 `upsert` 语义）。本区不单独做「编辑表单」，
 * 点一行的「编辑」把它的字段回填进新增表单 —— 两个动作共用同一个提交入口，少一个
 * 状态机，也少一处「编辑态和新增态长得不一样」的漂移。
 *
 * # 正文为什么是英文
 *
 * persona 进成员的启动 argv（与角色 preamble 同一读者：模型）。与代码注释（中文，
 * 读者是人）刻意分开。
 */
interface RoleLibrarySectionProps {
  roles: TeamRolesState;
  /** `agentId` → 显示名（CLI 建议下拉用，与成员池同一个显示名来源）。 */
  nameOf: (agentId: string) => string;
  /** CLI 建议（`cliPreference`）的候选；来自面板已有的可启动清单。 */
  agentIds: readonly string[];
  onShowToast?: (message: string, type?: 'info' | 'error') => void;
}

const RoleLibrarySection: React.FC<RoleLibrarySectionProps> = React.memo(
  ({ roles, nameOf, agentIds, onShowToast }) => {
    // 表单是**局部** state（与建队草稿同一条纪律：一次编辑动作的中间态不进 store）。
    const [name, setName] = useState('');
    const [preamble, setPreamble] = useState('');
    const [cli, setCli] = useState('');
    const [editing, setEditing] = useState(false);

    const reset = useCallback(() => {
      setName('');
      setPreamble('');
      setCli('');
      setEditing(false);
    }, []);

    const handleSave = useCallback(() => {
      const trimmedName = name.trim();
      const trimmedPreamble = preamble.trim();
      // 前端只做一眼就非法的预检（非空）；长度与控制字符的判据在后端（保存时拒绝）。
      if (trimmedName === '' || trimmedPreamble === '') return;
      void roles
        .saveRole({
          name: trimmedName,
          preamble: trimmedPreamble,
          cliPreference: cli === '' ? null : cli,
          approvalPolicy: null,
          defaultWorkspace: null,
          createdAt: Date.now(),
        })
        .then((ok) => {
          if (ok) {
            reset();
            onShowToast?.(`Role "${trimmedName}" saved`, 'info');
          }
        });
    }, [name, preamble, cli, roles, onShowToast, reset]);

    const handleDelete = useCallback(
      (role: RolePreset) => {
        void roles.deleteRole(role.name).then((ok) => {
          if (ok) onShowToast?.(`Role "${role.name}" deleted`, 'info');
        });
      },
      [roles, onShowToast],
    );

    const handleEdit = useCallback((role: RolePreset) => {
      setName(role.name);
      setPreamble(role.preamble);
      setCli(role.cliPreference ?? '');
      setEditing(true);
    }, []);

    const canSave = name.trim() !== '' && preamble.trim() !== '' && !roles.mutating;

    return (
      <section aria-label="Role library" className="flex flex-col gap-2 text-meta">
        <h3 className="text-meta font-semibold text-text-secondary">Role library</h3>
        <p className="text-micro text-text-muted">
          A persona is the text describing how a member works (it is spliced into its launch args at
          spawn); it is unrelated to permissions. Pick one as the default when creating the team;
          the lead can also assign them one by one.
        </p>

        {/* 三态分离（与团队配置区同一纪律）：没问到不显示空态 */}
        {roles.roles === null ? (
          roles.loading ? (
            <p className="text-meta text-text-muted">Loading role library…</p>
          ) : (
            <p className="text-meta text-text-muted">
              Role library unavailable (there is no second source).
            </p>
          )
        ) : roles.roles.length === 0 ? (
          <p className="text-meta text-text-muted">
            No presets yet — add the first one with the form below.
          </p>
        ) : (
          <>
            {roles.rolesTruncated ? (
              // 截断必须**说出来**（与任务板同一条纪律）：不说的话看起来像「就只有这些」。
              <p role="status" className="text-micro text-accent-yellow">
                Showing first {roles.roles.length} presets (older ones are not listed).
              </p>
            ) : null}
            <ul aria-label="Existing roles" className="flex flex-col gap-1">
              {roles.roles.map((role) => (
                <li
                  key={role.name}
                  className="flex flex-col gap-0.5 rounded-md border border-border bg-bg-primary px-2 py-1"
                >
                  <div className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-meta font-medium text-text-primary">
                      {role.name}
                    </span>
                    <button
                      type="button"
                      onClick={() => handleEdit(role)}
                      className="rounded px-1 py-0.5 text-micro text-text-secondary hover:bg-bg-hover focus-visible:ring-2 focus-visible:ring-accent-blue focus-visible:outline-none"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      disabled={roles.mutating}
                      onClick={() => handleDelete(role)}
                      className="rounded px-1 py-0.5 text-micro text-accent-red hover:bg-bg-hover focus-visible:ring-2 focus-visible:ring-accent-red focus-visible:outline-none disabled:cursor-not-allowed disabled:text-text-muted"
                    >
                      Delete
                    </button>
                  </div>
                  <p className="line-clamp-2 text-micro text-text-muted">{role.preamble}</p>
                  {role.cliPreference ? (
                    <p className="font-mono text-micro text-text-muted">
                      Suggested CLI: {nameOf(role.cliPreference)}
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          </>
        )}

        <ErrorNotice
          message={roles.error}
          retryLabel="Reload role library"
          onRetry={roles.reload}
        />
        {roles.mutationError ? (
          <p role="alert" className="whitespace-pre-wrap text-micro text-accent-red">
            {roles.mutationError}
          </p>
        ) : null}

        <div className="flex flex-col gap-1 rounded-md border border-border bg-bg-primary p-2">
          <span className="text-micro font-semibold text-text-secondary">
            {editing ? `Edit "${name}"` : 'New role'}
          </span>
          <Input
            aria-label="Role name"
            size="sm"
            value={name}
            placeholder="Role name (e.g. Researcher)"
            onChange={(e) => setName(e.target.value)}
          />
          <textarea
            aria-label="Persona body (English)"
            value={preamble}
            placeholder="Research only; never edit production code. Report findings to the board."
            rows={3}
            onChange={(e) => setPreamble(e.target.value)}
            className={cn(
              'w-full rounded-md border border-border bg-bg-primary px-2 py-1 text-meta',
              'text-text-primary placeholder:text-text-muted focus-visible:ring-2 focus-visible:ring-accent-blue focus-visible:outline-none',
            )}
          />
          <select
            aria-label="Suggested CLI"
            size={1}
            value={cli}
            onChange={(e) => setCli(e.target.value)}
            className="rounded-md border border-border bg-bg-primary px-2 py-1 text-meta text-text-primary focus-visible:ring-2 focus-visible:ring-accent-blue focus-visible:outline-none"
          >
            <option value="">No CLI preference</option>
            {agentIds.map((id) => (
              <option key={id} value={id}>
                {nameOf(id)}
              </option>
            ))}
          </select>
          <div className="flex gap-1.5">
            <button
              type="button"
              onClick={handleSave}
              disabled={!canSave}
              className={cn(
                'rounded-md px-2 py-1 text-meta font-medium focus-visible:ring-2 focus-visible:ring-accent-blue focus-visible:outline-none',
                canSave
                  ? 'bg-accent-blue text-text-on-accent hover:brightness-110'
                  : 'cursor-not-allowed bg-bg-tertiary text-text-muted',
              )}
            >
              {roles.mutating ? 'Saving…' : editing ? 'Save changes' : 'Add role'}
            </button>
            {editing ? (
              <button
                type="button"
                onClick={reset}
                className="rounded-md px-2 py-1 text-meta text-text-secondary hover:bg-bg-hover focus-visible:ring-2 focus-visible:ring-accent-blue focus-visible:outline-none"
              >
                Cancel editing
              </button>
            ) : null}
          </div>
        </div>
      </section>
    );
  },
);
RoleLibrarySection.displayName = 'RoleLibrarySection';

export default RoleLibrarySection;
