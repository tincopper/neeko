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
            onShowToast?.(`角色「${trimmedName}」已保存`, 'info');
          }
        });
    }, [name, preamble, cli, roles, onShowToast, reset]);

    const handleDelete = useCallback(
      (role: RolePreset) => {
        void roles.deleteRole(role.name).then((ok) => {
          if (ok) onShowToast?.(`角色「${role.name}」已删除`, 'info');
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
      <section aria-label="角色库" className="flex flex-col gap-2 text-meta">
        <h3 className="text-meta font-semibold text-text-secondary">角色库</h3>
        <p className="text-micro text-text-muted">
          persona 是「成员怎么干活」的人设文本（spawn 时拼进它的启动参数），与权限无关。
          建队时选一个作缺省，队长也可以逐个指定。
        </p>

        {/* 三态分离（与团队配置区同一纪律）：没问到不显示空态 */}
        {roles.roles === null ? (
          roles.loading ? (
            <p className="text-meta text-text-muted">正在读取角色库…</p>
          ) : (
            <p className="text-meta text-text-muted">拿不到角色库（没有第二个来源）。</p>
          )
        ) : roles.roles.length === 0 ? (
          <p className="text-meta text-text-muted">还没有预设 —— 用下面的表单加第一个。</p>
        ) : (
          <>
            {roles.rolesTruncated ? (
              // 截断必须**说出来**（与任务板同一条纪律）：不说的话看起来像「就只有这些」。
              <p role="status" className="text-micro text-accent-yellow">
                只显示前 {roles.roles.length} 个预设（更早的未列出）。
              </p>
            ) : null}
            <ul aria-label="已有角色" className="flex flex-col gap-1">
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
                      编辑
                    </button>
                    <button
                      type="button"
                      disabled={roles.mutating}
                      onClick={() => handleDelete(role)}
                      className="rounded px-1 py-0.5 text-micro text-accent-red hover:bg-bg-hover focus-visible:ring-2 focus-visible:ring-accent-red focus-visible:outline-none disabled:cursor-not-allowed disabled:text-text-muted"
                    >
                      删除
                    </button>
                  </div>
                  <p className="line-clamp-2 text-micro text-text-muted">{role.preamble}</p>
                  {role.cliPreference ? (
                    <p className="font-mono text-micro text-text-muted">
                      建议 CLI：{nameOf(role.cliPreference)}
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          </>
        )}

        <ErrorNotice message={roles.error} retryLabel="重新读取角色库" onRetry={roles.reload} />
        {roles.mutationError ? (
          <p role="alert" className="whitespace-pre-wrap text-micro text-accent-red">
            {roles.mutationError}
          </p>
        ) : null}

        <div className="flex flex-col gap-1 rounded-md border border-border bg-bg-primary p-2">
          <span className="text-micro font-semibold text-text-secondary">
            {editing ? `编辑「${name}」` : '新增角色'}
          </span>
          <Input
            aria-label="角色名"
            size="sm"
            value={name}
            placeholder="角色名（如：研究员）"
            onChange={(e) => setName(e.target.value)}
          />
          <textarea
            aria-label="人设正文（英文）"
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
            aria-label="建议 CLI"
            size={1}
            value={cli}
            onChange={(e) => setCli(e.target.value)}
            className="rounded-md border border-border bg-bg-primary px-2 py-1 text-meta text-text-primary focus-visible:ring-2 focus-visible:ring-accent-blue focus-visible:outline-none"
          >
            <option value="">不指定 CLI</option>
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
              {roles.mutating ? '正在保存…' : editing ? '保存修改' : '添加角色'}
            </button>
            {editing ? (
              <button
                type="button"
                onClick={reset}
                className="rounded-md px-2 py-1 text-meta text-text-secondary hover:bg-bg-hover focus-visible:ring-2 focus-visible:ring-accent-blue focus-visible:outline-none"
              >
                取消编辑
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
