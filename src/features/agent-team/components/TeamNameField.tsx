import React from 'react';

import { Input } from '@/ui/Input';

/**
 * 建队表单的**第一格**：团队名（可选）。
 *
 * # 为什么它是独立组件
 *
 * 它不是 `TeamConfig` 的字段（名字是 `start_team_session` 的独立入参 `name`），语义上也不属于
 * 下面三步的任何一步 —— 它是这支队伍的**主语**，所以排在页首、先于「队长 / 成员 / 默认值」。
 * 单独成件让 `TeamLaunchPanel` 保持组合层（那一步的排版细节 + 留空语义都收在这里）。
 *
 * # 留空 = 后端取工作区目录名
 *
 * 这里**没有**默认值可播种：缺省名由后端从工作区根推导（`bootstrap::resolve_name`），前端抄
 * 一份就会出现「输入框写着 A、实际叫 B」的第二份判据。placeholder 只描述这条规则的后果。
 */
interface TeamNameFieldProps {
  /** 原文（`''` = 还没填）。**不裁空白**：裁剪发生在提交时（`useTeamConfigDraft.name`）。 */
  value: string;
  /** 缺省值还没落地（`team_options` 未到）⇒ 表单整体不可编辑，与配置区同一时序。 */
  disabled: boolean;
  onChange: (next: string) => void;
}

const TeamNameField: React.FC<TeamNameFieldProps> = React.memo(({ value, disabled, onChange }) => (
  <div className="flex flex-col gap-1">
    <label htmlFor="team-launch-name" className="text-micro text-text-muted">
      团队名称（可选）
    </label>
    <Input
      id="team-launch-name"
      size="sm"
      value={value}
      placeholder="留空 = 用工作区目录名"
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
    />
  </div>
));
TeamNameField.displayName = 'TeamNameField';

export default TeamNameField;
