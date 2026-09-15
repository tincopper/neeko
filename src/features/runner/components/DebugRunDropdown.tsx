import React from 'react';

import { Play, Bug, Plus, Pencil, X } from '@/shared/components/icons';

import type { EntryPoint, LaunchConfig } from '../types';

interface DebugRunDropdownProps {
  /** 自动发现的入口点（Go/Rust main 等）。 */
  entries: EntryPoint[];
  /** 显式 launch 配置。 */
  configs: LaunchConfig[];
  /** 当前选中的配置名（`selected` 标记）。 */
  selectedConfigName: string | null;
  /** 无项目时禁用「Add Config」。 */
  canAdd: boolean;
  onSelect: (name: string) => void;
  onDebugEntry: (entry: EntryPoint) => void;
  onRunEntry: (e: React.MouseEvent, entry: EntryPoint) => void;
  onEdit: (e: React.MouseEvent, config: LaunchConfig) => void;
  onDelete: (e: React.MouseEvent, config: LaunchConfig) => void;
  onAdd: () => void;
}

/**
 * Debug 工具栏的下拉面板：入口点 + launch 配置 + 「Add Config」。
 *
 * 纯展示（props 进、回调出）：`DebugRunButton` 的容器逻辑（store 订阅、副作用、
 * 选中/删除编排）不下沉到这里，因此本组件可脱离 store 单测，也不会因为 store 变化
 * 而重新膨胀。
 */
const DebugRunDropdown: React.FC<DebugRunDropdownProps> = ({
  entries,
  configs,
  selectedConfigName,
  canAdd,
  onSelect,
  onDebugEntry,
  onRunEntry,
  onEdit,
  onDelete,
  onAdd,
}) => {
  return (
    <div className="absolute top-full right-0 mt-1.5 w-80 bg-bg-secondary border border-border rounded-lg shadow-xl z-50 overflow-hidden">
      {entries.length > 0 && (
        <>
          <div className="px-3 py-1.5 text-[10px] font-medium text-text-muted uppercase tracking-wide">
            Application entries
          </div>
          <div className="pb-1 max-h-48 overflow-y-auto">
            {entries.map((entry) => (
              <div
                key={entry.id}
                className="group flex items-center gap-1 px-2 py-1.5 hover:bg-bg-hover"
              >
                <button
                  type="button"
                  className="flex-1 min-w-0 flex items-center gap-2 px-1 py-0.5 text-left cursor-pointer"
                  onClick={() => onDebugEntry(entry)}
                  title={`Debug ${entry.name}`}
                >
                  <Bug size={12} className="shrink-0 text-accent-blue" />
                  <div className="flex-1 min-w-0">
                    <div className="text-[var(--font-size)] text-text-primary truncate">
                      {entry.name}
                    </div>
                    <div className="text-[10px] text-text-muted truncate">
                      {entry.language} · {entry.programTemplate}
                    </div>
                  </div>
                </button>
                <button
                  type="button"
                  className="flex items-center gap-1 px-1.5 py-1 rounded text-[10px] text-text-secondary hover:bg-bg-primary hover:text-accent-green cursor-pointer shrink-0"
                  title={`Run: ${entry.runCommand}`}
                  onClick={(e) => onRunEntry(e, entry)}
                >
                  <Play size={10} fill="currentColor" strokeWidth={0} />
                  Run
                </button>
                <button
                  type="button"
                  className="flex items-center gap-1 px-1.5 py-1 rounded text-[10px] text-text-secondary hover:bg-bg-primary hover:text-accent-blue cursor-pointer shrink-0"
                  title={`Debug ${entry.name}`}
                  onClick={() => onDebugEntry(entry)}
                >
                  <Bug size={10} />
                  Debug
                </button>
              </div>
            ))}
          </div>
          <div className="border-t border-border" />
        </>
      )}

      {configs.length > 0 ? (
        <>
          <div className="px-3 py-1.5 text-[10px] font-medium text-text-muted uppercase tracking-wide">
            Launch configs
          </div>
          <div className="pb-1 max-h-48 overflow-y-auto">
            {configs.map((config) => (
              <div
                key={config.name}
                role="option"
                tabIndex={0}
                aria-selected={false}
                className="group flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-bg-hover"
                onClick={() => onSelect(config.name)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onSelect(config.name);
                  }
                }}
              >
                <Bug size={12} className="shrink-0 text-accent-blue" />
                <div className="flex-1 min-w-0">
                  <div className="text-[var(--font-size)] text-text-primary truncate">
                    {config.name}
                  </div>
                  <div className="text-[10px] text-text-muted truncate">
                    {config.type} · {config.program ?? config.request}
                  </div>
                </div>
                {selectedConfigName === config.name && (
                  <span className="text-[10px] text-accent-green shrink-0">selected</span>
                )}
                <button
                  className="opacity-0 group-hover:opacity-100 text-text-muted hover:text-text-primary transition-opacity cursor-pointer shrink-0"
                  onClick={(e) => onEdit(e, config)}
                  title="Edit config"
                >
                  <Pencil size={12} />
                </button>
                <button
                  className="opacity-0 group-hover:opacity-100 text-text-muted hover:text-accent-red transition-opacity cursor-pointer shrink-0"
                  onClick={(e) => onDelete(e, config)}
                  title="Delete config"
                >
                  <X size={12} />
                </button>
              </div>
            ))}
          </div>
        </>
      ) : entries.length === 0 ? (
        <div className="px-3 py-2.5 text-[var(--font-size)] text-text-muted">
          No launch configs or entry points found
        </div>
      ) : null}

      <div className="border-t border-border" />

      <button
        className="flex items-center gap-2 w-full px-3 py-2 text-[var(--font-size)] text-text-secondary hover:bg-bg-hover hover:text-text-primary cursor-pointer disabled:opacity-50"
        onClick={onAdd}
        disabled={!canAdd}
        title={canAdd ? 'Add launch configuration' : 'Select a project first'}
      >
        <Plus size={14} />
        <span>Add Config...</span>
      </button>
    </div>
  );
};

export default React.memo(DebugRunDropdown);
