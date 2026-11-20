import { useCallback, useEffect, useRef, useState } from 'react';

import type { RolePreset } from '@/shared/types/team';
import { invokeErrorMessage } from '@/shared/utils/invokeError';

import { deleteTeamRole, fetchTeamRoles, saveTeamRole } from '../api/teamApi';

/**
 * 角色库（persona 预设）的数据面：清单 + 保存 + 删除。
 *
 * # 为什么不接脉冲
 *
 * 角色库不隶属任何团队、不是团队状态 —— 团队的写路径不发它的脉冲（`team-domain.md`
 * §8.3：脉冲只说「团队的东西变了」）。刷新只有两个入口：挂载拉一次、本 hook 自己的
 * save/delete 成功后本地重取。将来若角色库跨面板共享，再考虑提为独立失效源，今天
 * 两个消费者（缺省角色下拉、库管理区）都挂在本面板。
 *
 * # 三态分离（与 `useTeamList` 同一条纪律）
 *
 * `roles === null && loading` = 还没问到（不显示空态）；`null && !loading` = 失败且从未
 * 成功（错误原文 + 重试）；`[]` = 库真的空（「还没有预设」）。失败**不清空**上一次的
 * 清单：闪空比旧数据更糟。
 */
export interface TeamRolesState {
  roles: RolePreset[] | null;
  /** 后端置位：角色行数超过 `MAX_LISTED_ROLES` 被截断（UI 必须说出来）。 */
  rolesTruncated: boolean;
  loading: boolean;
  /** 最近一次读取失败的可读原因；`null` = 没有错误。 */
  error: string | null;
  /** 保存 / 删除的在飞标记（按钮置灰，避免连点）。 */
  mutating: boolean;
  /** 最近一次保存 / 删除失败的可读原因；`null` = 没有错误。 */
  mutationError: string | null;
  reload: () => void;
  /**
   * 保存一个预设；**结果走返回值**（不靠调用方回读 `mutationError`）。
   *
   * 返回 `error` 而不是 `boolean` 的原因：`mutationError` 是异步 setState，调用方
   * 拿到的闭包值在 `await` 之后仍是旧 `null`（「保存失败却显示兜底文案」的成因）。
   * 把错误原文放进返回对象，调用方读到的就是本次请求的结果。
   */
  saveRole: (role: RolePreset) => Promise<{ ok: boolean; error?: string }>;
  deleteRole: (name: string) => Promise<{ ok: boolean; error?: string }>;
}

export function useTeamRoles(): TeamRolesState {
  const [roles, setRoles] = useState<RolePreset[] | null>(null);
  const [rolesTruncated, setRolesTruncated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mutating, setMutating] = useState(false);
  const [mutationError, setMutationError] = useState<string | null>(null);

  const generation = useRef(0);

  const load = useCallback(async (): Promise<void> => {
    const mine = ++generation.current;
    setLoading(true);
    try {
      const next = await fetchTeamRoles();
      if (mine !== generation.current) return;
      setRoles(next.roles);
      setRolesTruncated(next.truncated);
      setError(null);
    } catch (err: unknown) {
      if (mine !== generation.current) return;
      // 不清空 roles：见文件头「失败不清空」。
      setError(invokeErrorMessage(err, 'Could not list the role presets'));
    } finally {
      if (mine === generation.current) setLoading(false);
    }
  }, []);

  const reload = useCallback(() => {
    void load();
  }, [load]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 挂载拉取（项目既有模式，见 useTeamList）
    void load();
    return () => {
      generation.current += 1;
    };
  }, [load]);

  /** 保存后本地重取（角色库没有脉冲，成功与否都以后端回话为准）。 */
  const saveRole = useCallback(
    async (role: RolePreset): Promise<{ ok: boolean; error?: string }> => {
      setMutating(true);
      setMutationError(null);
      try {
        await saveTeamRole(role);
        await load();
        return { ok: true };
      } catch (err: unknown) {
        const message = invokeErrorMessage(err, 'Could not save the role preset');
        setMutationError(message);
        return { ok: false, error: message };
      } finally {
        setMutating(false);
      }
    },
    [load],
  );

  const deleteRole = useCallback(
    async (name: string): Promise<{ ok: boolean; error?: string }> => {
      setMutating(true);
      setMutationError(null);
      try {
        await deleteTeamRole(name);
        await load();
        return { ok: true };
      } catch (err: unknown) {
        const message = invokeErrorMessage(err, 'Could not delete the role preset');
        setMutationError(message);
        return { ok: false, error: message };
      } finally {
        setMutating(false);
      }
    },
    [load],
  );

  return {
    roles,
    rolesTruncated,
    loading,
    error,
    mutating,
    mutationError,
    reload,
    saveRole,
    deleteRole,
  };
}
