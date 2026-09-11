/** 项目级覆盖项：Agent / IDE / 主语言（受控组件，写操作经父级 props 上抛）。 */

import type { Project } from '@/shared/types';
import { IDE_PRESETS } from '@/shared/utils/idePresets';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/ui';

interface Props {
  project: Project;
  agents: { id: string; name: string }[];
  customIdes: { name: string; command: string }[];
  /** 自动探测结果，仅用于展示 "detected: <lang>"。 */
  projectProfile: { primary?: { languageId: string } | null } | null;
  primaryLanguageOptions: { id: string; label: string }[];
  onAgentChange: (value: string) => void;
  onIdeChange: (value: string) => void;
  onPrimaryLanguageChange: (value: string) => void;
}

export default function ProjectOverridesSection({
  project,
  agents,
  customIdes,
  projectProfile,
  primaryLanguageOptions,
  onAgentChange,
  onIdeChange,
  onPrimaryLanguageChange,
}: Props) {
  return (
    <div className="mb-6">
      <div className="text-[0.86em] text-text-primary font-medium mb-1">Project Overrides</div>
      <div className="text-[0.79em] text-text-muted mb-3">
        Agent, IDE, and primary language preferences specific to this project.
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <div className="text-[0.79em] text-text-muted mb-1.5">Agent</div>
          <Select
            value={project.selected_agents?.[0] ?? '__global__'}
            onValueChange={onAgentChange}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__global__">Use global default</SelectItem>
              {agents.map((a) => (
                <SelectItem key={a.id} value={a.id}>
                  {a.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <div className="text-[0.79em] text-text-muted mb-1.5">IDE</div>
          <Select value={project.selected_ide ?? '__global__'} onValueChange={onIdeChange}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__global__">Use global default</SelectItem>
              {IDE_PRESETS.map((ide) => (
                <SelectItem key={ide.id} value={ide.id}>
                  {ide.name}
                </SelectItem>
              ))}
              {customIdes.map((ide) => (
                <SelectItem key={ide.name} value={ide.command}>
                  {ide.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="col-span-2">
          <div className="text-[0.79em] text-text-muted mb-1.5">Primary language (LSP)</div>
          <Select
            value={project.primary_language ?? '__auto__'}
            onValueChange={onPrimaryLanguageChange}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__auto__">
                Auto
                {projectProfile?.primary
                  ? ` (detected: ${projectProfile.primary.languageId})`
                  : ' (from root markers)'}
              </SelectItem>
              {primaryLanguageOptions.map((opt) => (
                <SelectItem key={opt.id} value={opt.id}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="text-[0.75em] text-text-muted mt-1.5">
            Monorepos only soft-warm one primary language. Override when auto detection picks the
            wrong stack.
          </div>
        </div>
      </div>
    </div>
  );
}
