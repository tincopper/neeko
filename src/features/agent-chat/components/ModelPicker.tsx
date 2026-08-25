import { ChevronDown, Search, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { ModelInfo } from '@/features/agent/api/agentApi';

import { AgentBadge } from './AgentBadge';
import { displayName } from './constants';

// ─── 模型搜索 Hook ───
// 高内聚：只负责搜索状态和过滤逻辑
// 低耦合：不依赖任何 UI 组件，可复用于任何需要模型搜索的场景
function useModelSearch(models: ModelInfo[]) {
  const [search, setSearch] = useState('');

  const filteredModels = useMemo(() => {
    if (!search.trim()) return models;
    const q = search.toLowerCase().trim();
    return models.filter(
      (m) =>
        m.name.toLowerCase().includes(q) ||
        (m.provider_name ?? m.provider_id ?? '').toLowerCase().includes(q) ||
        m.id.toLowerCase().includes(q),
    );
  }, [models, search]);

  const clearSearch = useCallback(() => setSearch(''), []);

  return { search, setSearch, filteredModels, clearSearch };
}

// ─── 模型搜索输入框 ───
// 高内聚：只负责搜索输入的 UI 渲染
// 低耦合：通过 props 接收状态和回调，不关心过滤逻辑
interface ModelSearchInputProps {
  value: string;
  onChange: (value: string) => void;
  onClear: () => void;
  onEscape: () => void;
  inputRef?: React.Ref<HTMLInputElement>;
}

function ModelSearchInput({ value, onChange, onClear, onEscape, inputRef }: ModelSearchInputProps) {
  return (
    <div className="model-search-wrap">
      <Search size={14} className="model-search-icon" />
      <input
        ref={inputRef}
        type="text"
        className="model-search-input"
        placeholder="Search models..."
        value={value}
        maxLength={100}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onEscape();
        }}
      />
      {value && (
        <button
          type="button"
          className="model-search-clear"
          onClick={onClear}
          aria-label="Clear search"
        >
          <X size={12} />
        </button>
      )}
    </div>
  );
}

// ─── 模型列表 ───
// 高内聚：只负责渲染模型列表
// 低耦合：通过 props 接收数据和回调，不关心搜索逻辑
interface ModelListProps {
  models: ModelInfo[];
  selectedId: string | undefined;
  onSelect: (model: ModelInfo) => void;
  /** 当前所选 agent（用于列表项图标展示）。 */
  agent: { id: string; name: string; icon?: string | null };
  emptyMessage?: string;
}

function ModelList({
  models,
  selectedId,
  onSelect,
  agent,
  emptyMessage = 'No models available',
}: ModelListProps) {
  if (models.length === 0) {
    return <div className="attach-empty">{emptyMessage}</div>;
  }

  return (
    <>
      {models.map((m) => (
        <button
          key={m.id}
          className={`param-option${selectedId === m.id ? ' selected' : ''}`}
          onClick={() => onSelect(m)}
        >
          <span className="param-opt-icon">
            <AgentBadge icon={agent.icon} name={agent.name} id={agent.id} />
          </span>
          <span className="param-opt-info">
            <span className="param-opt-name">{displayName(m.name)}</span>
            <span className="param-opt-desc">
              {m.provider_name ?? m.provider_id ?? 'unknown'}
              {m.context_window ? ` · ${(m.context_window / 1000).toFixed(0)}k ctx` : ''}
              {m.is_free ? ' · free' : ''}
            </span>
          </span>
        </button>
      ))}
    </>
  );
}

// ─── 模型选择器（容器组件）───
// 高内聚：负责协调子组件，处理下拉框开关逻辑
// 低耦合：组合 useModelSearch + ModelSearchInput + ModelList
function ModelPicker({
  models,
  selected,
  onChange,
  agent,
}: {
  models: ModelInfo[];
  selected: ModelInfo | null;
  onChange: (model: ModelInfo) => void;
  /** 当前所选 agent（按钮与列表项图标展示）。 */
  agent: { id: string; name: string; icon?: string | null };
}) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const { search, setSearch, filteredModels, clearSearch } = useModelSearch(models);

  const positionDropdown = useCallback(() => {
    if (!btnRef.current) return;
    const rect = btnRef.current.getBoundingClientRect();
    const dropdown = btnRef.current
      .closest('.param-selector-wrap')
      ?.querySelector('.param-dropdown') as HTMLElement;
    if (dropdown) {
      dropdown.style.bottom = `${window.innerHeight - rect.top + 8}px`;
      dropdown.style.left = `${rect.left}px`;
    }
  }, []);

  // 打开下拉框时聚焦搜索框
  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(() => searchRef.current?.focus(), 50);
    return () => clearTimeout(timer);
  }, [open]);

  const handleClose = useCallback(() => {
    setOpen(false);
    clearSearch();
  }, [clearSearch]);

  const handleSelect = useCallback(
    (model: ModelInfo) => {
      onChange(model);
      handleClose();
    },
    [onChange, handleClose],
  );

  const current = selected ?? null;
  const displayNameLabel = current
    ? displayName(current.name).length > 20
      ? `${displayName(current.name).slice(0, 18)}…`
      : displayName(current.name)
    : 'Select model';

  return (
    <div className="param-selector-wrap">
      <button
        ref={btnRef}
        className={`param-selector-btn model-picker-btn${open ? ' open' : ''}`}
        onClick={() => {
          if (!open) {
            setOpen(true);
            setTimeout(positionDropdown, 0);
          } else {
            handleClose();
          }
        }}
        title={
          current
            ? `${current.id} (${current.provider_name ?? current.provider_id ?? 'unknown'})`
            : 'Select model'
        }
      >
        <span className="param-icon">
          <AgentBadge icon={agent.icon} name={agent.name} id={agent.id} />
        </span>
        <span className="param-name">{displayNameLabel}</span>
        <span className="param-chevron">
          <ChevronDown size={12} />
        </span>
      </button>
      {open && (
        <>
          <div
            className="drop-overlay"
            role="button"
            tabIndex={0}
            aria-label="关闭下拉菜单"
            onClick={handleClose}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                handleClose();
              }
            }}
          />
          <div className="param-dropdown show model-dropdown-scroll">
            <ModelSearchInput
              value={search}
              onChange={setSearch}
              onClear={clearSearch}
              onEscape={handleClose}
              inputRef={searchRef}
            />
            <ModelList
              models={filteredModels}
              selectedId={current?.id}
              onSelect={handleSelect}
              agent={agent}
              emptyMessage={models.length === 0 ? 'No models available' : 'No matching models'}
            />
          </div>
        </>
      )}
    </div>
  );
}

export { ModelPicker };
