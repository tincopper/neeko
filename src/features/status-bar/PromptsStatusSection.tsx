import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';

import { usePromptInsert } from '@/features/library';
import { useLibraryStore } from '@/features/library/store/libraryStore';
import { cn } from '@/lib/utils';
import { MessageSquare } from '@/shared/components/icons';
import { useAppContext, useTerminalInsert } from '@/shared/contexts';
import { useEditorStore } from '@/shared/store/editorStore';
import { useProjectStore } from '@/shared/store/projectStore';
import { useWorktreeStore } from '@/shared/store/worktreeStore';
import type { PromptResource } from '@/shared/types/library';
import { resolveTabKey } from '@/shared/utils/tabKey';

/** 描述规则：description 优先，为空回退 content 首 120 字（换行转空格）。 */
function promptDescription(prompt: PromptResource): string {
  if (prompt.description) return prompt.description;
  return prompt.content.slice(0, 120).replace(/\n/g, ' ');
}

/** 排序：favorite 置顶 + lastUsedAt 倒序。 */
function sortPrompts(prompts: PromptResource[]): PromptResource[] {
  return [...prompts].sort((a, b) => {
    if (a.favorite !== b.favorite) return a.favorite ? -1 : 1;
    return (b.lastUsedAt ?? 0) - (a.lastUsedAt ?? 0);
  });
}

/** 过滤复用 PromptInsertDialog 逻辑（name/slash/description/tags），取前 20。 */
function filterPrompts(prompts: PromptResource[], query: string): PromptResource[] {
  const q = query.trim().toLowerCase();
  if (!q) return prompts.slice(0, 20);
  return prompts
    .filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.slash?.toLowerCase().includes(q) ||
        p.description?.toLowerCase().includes(q) ||
        p.tags.some((t) => t.toLowerCase().includes(q)),
    )
    .slice(0, 20);
}
/**
 * 插入成功后把终端推到前台。
 *
 * dock 注册表（app/dock/registry.ts + shared/dock/panelMeta.ts）没有终端面板——
 * 终端是中央编辑器区的 `terminal` kind tab——因此不走 dockStore.togglePanel /
 * activatePanel（无明确 panelId 可查，硬编码猜测只会静默 no-op），而是直接激活
 * 本项目 tab 组里的终端 tab。已在终端上或找不到终端 tab 时静默跳过
 * （写入本身已成功，不打扰用户）。
 */
function revealTerminalTab(projectId: string): void {
  const editorState = useEditorStore.getState();
  const tabKey = resolveTabKey(projectId, useWorktreeStore.getState().activeWorktreePath);
  const group = editorState.tabs[tabKey];
  const tabs = group?.tabs ?? [];
  if (tabs.some((t) => t.id === group?.activeTabId && t.data.kind === 'terminal')) return;
  const terminalTab = tabs.find((t) => t.data.kind === 'terminal');
  if (terminalTab) editorState.activateTab(tabKey, terminalTab.id);
}

/**
 * Status-bar prompts 快捷入口：下拉列出 library prompts，点击经变量渲染后
 * 追加键入活动 terminal（不执行）。无 activeProjectId 时隐藏。
 */
export function PromptsStatusSection() {
  const activeProjectId = useProjectStore((s) => s.activeProject?.id ?? null);
  const prompts = useLibraryStore((s) => s.prompts);
  const { api } = useTerminalInsert();
  const { showToast } = useAppContext();

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [dropdownStyle, setDropdownStyle] = useState<CSSProperties | undefined>(undefined);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleInsertPrompt = useCallback(
    (prompt: PromptResource) => {
      // 成功静默（内容已直观落在终端里），仅把终端推到前台；失败才 toast。
      if (api.insertToTerminal?.(prompt.content)) {
        if (activeProjectId) revealTerminalTab(activeProjectId);
        return;
      }
      showToast('无活动终端', 'info');
    },
    [api, showToast, activeProjectId],
  );
  const insert = usePromptInsert(handleInsertPrompt);

  const filtered = useMemo(() => filterPrompts(sortPrompts(prompts), query), [prompts, query]);

  // 打开时 prompts 为空则拉取一次；聚焦搜索框。（高亮重置在打开/输入事件里做，避免 effect 内 setState。）
  useEffect(() => {
    if (!open) return;
    if (prompts.length === 0) {
      void useLibraryStore.getState().refreshPrompts();
    }
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [open, prompts.length]);

  // 复用 LspStatusSection 骨架：从 chip 上弹定位 + portal。
  useEffect(() => {
    if (open && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      setDropdownStyle({
        position: 'fixed',
        bottom: window.innerHeight - rect.top + 4,
        right: Math.max(8, window.innerWidth - rect.right),
        width: 320,
      });
    } else {
      setDropdownStyle(undefined);
    }
  }, [open]);

  const close = useCallback(() => {
    setOpen(false);
    setQuery('');
  }, []);

  // 外部点击关闭。
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        dropdownRef.current?.contains(target) ||
        buttonRef.current?.contains(target) ||
        (target as Element).closest?.('[data-prompts-dropdown]')
      ) {
        return;
      }
      close();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open, close]);

  // Esc 关闭。
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        close();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, close]);

  const handleRowClick = useCallback(
    (prompt: PromptResource) => {
      close();
      insert(prompt, 'terminal');
    },
    [close, insert],
  );
  // 搜索框键盘：Enter 确认当前高亮项（无结果则无操作），上下键在结果内移动高亮
  // （与 PromptInsertDialog:62-79 同语义，含到尾回绕）；Esc 由文档级监听保持关闭。
  const handleSearchKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIdx((prev) => (prev + 1) % Math.max(filtered.length, 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIdx((prev) => (prev - 1 + filtered.length) % Math.max(filtered.length, 1));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const prompt = filtered[selectedIdx];
        if (prompt) handleRowClick(prompt);
      }
    },
    [filtered, selectedIdx, handleRowClick],
  );

  if (!activeProjectId) return null;

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => {
          if (!open) setSelectedIdx(0);
          if (open) close();
          else setOpen(true);
        }}
        className={cn(
          'relative flex items-center gap-1.5 hover:text-text-primary cursor-pointer',
          open ? 'text-text-primary' : '',
        )}
        title="Insert prompt to terminal"
        data-testid="prompts-status-chip"
      >
        <MessageSquare size={12} className="shrink-0" />
        <span>Prompts</span>
      </button>

      {open &&
        dropdownStyle &&
        createPortal(
          <div
            ref={dropdownRef}
            data-prompts-dropdown
            data-testid="prompts-status-dropdown"
            className="bg-popover border border-border rounded-md shadow-lg py-1 z-50 text-xs text-text-primary"
            style={dropdownStyle}
          >
            <div className="px-2 pb-1">
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setSelectedIdx(0);
                }}
                onKeyDown={handleSearchKeyDown}
                placeholder="Search prompts…"
                data-testid="prompts-status-search"
                className={cn(
                  'w-full h-7 px-2 text-xs rounded-md',
                  'bg-bg-primary border border-border text-text-primary',
                  'outline-none focus:border-accent-blue placeholder:text-text-muted',
                )}
                autoComplete="off"
                spellCheck={false}
              />
            </div>
            <div
              role="listbox"
              aria-label="Prompts"
              className="max-h-[min(320px,45vh)] overflow-y-auto py-1"
            >
              {filtered.length === 0 ? (
                <div
                  data-testid="prompts-status-empty"
                  className="px-4 py-6 text-center text-text-muted"
                >
                  {prompts.length === 0 ? 'No prompts yet — create one in Library' : 'No matches'}
                </div>
              ) : (
                filtered.map((prompt, idx) => (
                  <button
                    key={prompt.id}
                    type="button"
                    role="option"
                    aria-selected={idx === selectedIdx}
                    data-testid={`prompts-status-row-${prompt.id}`}
                    title={prompt.name}
                    onClick={() => handleRowClick(prompt)}
                    onMouseEnter={() => setSelectedIdx(idx)}
                    className={cn(
                      'w-full text-left px-3 py-1.5 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent-blue',
                      idx === selectedIdx ? 'bg-bg-hover' : 'hover:bg-bg-hover',
                    )}
                  >
                    <div className="min-w-0">
                      <div className="truncate">{prompt.name}</div>
                      <div className="text-[11px] text-text-muted truncate mt-0.5">
                        {promptDescription(prompt)}
                      </div>
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}

export default PromptsStatusSection;
