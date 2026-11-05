import { LayoutGrid, Pencil, Plus, RefreshCw, Trash2 } from 'lucide-react';
import React, { useEffect, useRef } from 'react';

import { cn } from '@/lib/utils';
import DeleteConfirmDialog from '@/shared/components/DeleteConfirmDialog';
import InlineRenameInput from '@/shared/components/InlineRenameInput';
import CountLabel from '@/shared/components/nav/CountLabel';
import NavEmpty from '@/shared/components/nav/NavEmpty';
import NavRow from '@/shared/components/nav/NavRow';
import NavSection from '@/shared/components/nav/NavSection';
import type { TagGroupCrud, TagGroupCrudItem } from '@/shared/hooks/useTagGroupCrud';
import { Input } from '@/ui/Input';

interface TagGroupRailProps {
  /** `useTagGroupCrud` 的返回（或其超集）——CRUD 状态与处理器。 */
  crud: TagGroupCrud;
  groups: readonly TagGroupCrudItem[];
  /** 激活的分组 id（Skills 侧直传数组；MCP 侧单值 → `[id]` 包装）。 */
  activeIds: readonly string[];
  onSelect: (id: string) => void;
  /** 无分组时的提示（两侧文案不同：skills / servers）。 */
  emptyText: string;
  confirmTitle: string;
  /** 删除确认框正文（按被删分组渲染，可带成员数）。 */
  describeDelete: (group: TagGroupCrudItem) => React.ReactNode;
  /** 可选能力：同步到 agents（仅 Skills 侧提供；未提供则不渲染同步按钮）。 */
  syncingId?: string | null;
  onSync?: (id: string, name: string) => void;
}

interface TagGroupRailRowProps {
  group: TagGroupCrudItem;
  active: boolean;
  /** 非 null = 该行处于重命名态，值为当前草稿（`''` 亦是合法草稿）。 */
  renameDraft: string | null;
  syncing: boolean;
  onSelect: (id: string) => void;
  onRenameStart: (item: TagGroupCrudItem) => void;
  onRenameValueChange: (value: string) => void;
  /** 值由受控输入在调用点显式传入 —— 处理器身份与草稿解耦（行 memo 生效的前提）。 */
  onRenameSubmit: (id: string, value: string) => void;
  onRenameCancel: () => void;
  onDelete: (id: string) => void;
  /** 可选能力：同步到 agents（仅 Skills 侧提供）。 */
  onSync?: (id: string, name: string) => void;
}

/**
 * 单个分组的行：图标 + 名称（重命名时就地换输入框）+ 计数 + 动作（重命名 / 同步? / 删除）。
 *
 * 用个体 props 而非整个 crud bag（依赖面收窄），且全部处理器都是共享 hook 的稳定
 * useCallback；草稿值只传给正在重命名的行（`renameDraft`）→ 键入时其余行不重渲染。
 */
const TagGroupRailRow: React.FC<TagGroupRailRowProps> = React.memo(
  ({
    group,
    active,
    renameDraft,
    syncing,
    onSelect,
    onRenameStart,
    onRenameValueChange,
    onRenameSubmit,
    onRenameCancel,
    onDelete,
    onSync,
  }) => (
    <NavRow
      active={active}
      onSelect={() => onSelect(group.id)}
      leading={<LayoutGrid className="h-3.5 w-3.5 shrink-0 opacity-50" />}
      actions={
        <>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onRenameStart(group);
            }}
            className="p-0.5 rounded text-text-muted hover:text-text-primary"
            title="Rename tag"
          >
            <Pencil className="h-3 w-3" />
          </button>
          {onSync ? (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onSync(group.id, group.name);
              }}
              className="p-0.5 rounded text-text-muted hover:text-text-primary"
              title="Sync to agents"
              disabled={syncing}
            >
              <RefreshCw className={cn('h-3 w-3', syncing && 'animate-spin')} />
            </button>
          ) : null}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onDelete(group.id);
            }}
            className="p-0.5 rounded text-text-muted hover:text-accent-red"
            title="Delete tag"
          >
            <Trash2 className="h-3 w-3" />
          </button>
        </>
      }
    >
      {renameDraft !== null ? (
        <InlineRenameInput
          value={renameDraft}
          onChange={onRenameValueChange}
          onCommit={() => void onRenameSubmit(group.id, renameDraft)}
          onCancel={onRenameCancel}
        />
      ) : (
        <span className="truncate flex-1 font-medium">{group.name}</span>
      )}
      <CountLabel loading={false} count={group.count} />
    </NavRow>
  ),
);

TagGroupRailRow.displayName = 'TagGroupRailRow';

/**
 * Tags 左栏区块（Skills 面板与 MCP 导航面板共用）：创建 / 重命名 / 删除。
 *
 * 合并前两侧各有一份 JSX（~150 行）且行为分歧——统一取 Skills 侧的富变体：
 * 创建行含 Add 按钮、进入编辑态自动聚焦（取自 MCP 侧）、New Tag 入口恒显示、
 * 智能确认（`count > 0` 才弹框，见 `useTagGroupCrud`）。
 * 差异面全部收敛为「注入的数据」：emptyText / confirmTitle / describeDelete / 可选 onSync。
 */
const TagGroupRail: React.FC<TagGroupRailProps> = ({
  crud,
  groups,
  activeIds,
  onSelect,
  emptyText,
  confirmTitle,
  describeDelete,
  syncingId,
  onSync,
}) => {
  // 创建行的「挂载即聚焦」留在本地：它是一次性的单一用途 effect（只依赖 `creating`），
  // 与曾经漂移的改名焦点不同 —— 改名（focus + 全选）已沉到 `InlineRenameInput`，
  // 本组件不再持有重命名 ref。
  const createInputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (crud.creating) createInputRef.current?.focus();
  }, [crud.creating]);

  return (
    <>
      <NavSection
        title="Tags"
        defaultExpanded
        listClassName="pb-2 px-1.5"
        actions={
          <button
            type="button"
            className="p-1 rounded-md text-text-muted hover:bg-bg-hover hover:text-text-primary transition-colors"
            title="New tag group"
            onClick={crud.startCreate}
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        }
      >
        {crud.creating ? (
          <div className="px-1.5 py-1 flex gap-1 items-center mb-0.5">
            <Input
              ref={createInputRef}
              size="sm"
              className="flex-1 min-w-0 text-[var(--font-size)]"
              placeholder="e.g. Backend"
              value={crud.newName}
              onChange={(e) => crud.setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void crud.submitCreate();
                if (e.key === 'Escape') crud.cancelCreate();
              }}
              onBlur={() => {
                if (!crud.newName.trim()) crud.cancelCreate();
              }}
            />
            <button
              type="button"
              className="h-7 px-2.5 text-[11px] font-medium text-text-primary bg-bg-selected hover:bg-bg-hover rounded-md shrink-0 border border-border"
              onClick={() => void crud.submitCreate()}
            >
              Add
            </button>
          </div>
        ) : null}

        {groups.length === 0 && !crud.creating ? (
          <NavEmpty className="py-2 leading-snug">{emptyText}</NavEmpty>
        ) : null}

        {groups.map((group) => (
          <TagGroupRailRow
            key={group.id}
            group={group}
            active={activeIds.includes(group.id)}
            renameDraft={crud.renamingId === group.id ? crud.renameValue : null}
            syncing={syncingId === group.id}
            onSelect={onSelect}
            onRenameStart={crud.startRename}
            onRenameValueChange={crud.setRenameValue}
            onRenameSubmit={crud.submitRename}
            onRenameCancel={crud.cancelRename}
            onDelete={crud.requestDelete}
            onSync={onSync}
          />
        ))}

        {!crud.creating ? (
          <button
            type="button"
            className="flex items-center gap-2 w-full px-2.5 py-1.5 rounded-md text-[var(--font-size)] text-text-muted hover:bg-bg-hover hover:text-text-secondary transition-colors"
            onClick={crud.startCreate}
          >
            <Plus className="h-3.5 w-3.5" />
            New Tag
          </button>
        ) : null}
      </NavSection>

      {/* 弹框作为 NavSection 的兄弟节点：区块折叠时不渲染 children，弹框不能挂在里面 */}
      <DeleteConfirmDialog
        pending={crud.pendingDelete}
        onCancel={crud.cancelDelete}
        onConfirm={() => crud.confirmDelete()}
        title={confirmTitle}
        describe={describeDelete}
      />
    </>
  );
};

TagGroupRail.displayName = 'TagGroupRail';

export default TagGroupRail;
