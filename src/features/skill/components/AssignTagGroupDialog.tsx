import { Check, Code, Globe, Loader2, Palette, Plus, Tags, Wrench, X } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { cn } from '@/lib/utils';
import type { TagGroup } from '@/shared/types';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/ui';

interface AssignTagGroupDialogProps {
  open: boolean;
  skillName: string;
  skillId: string;
  tagGroups: TagGroup[];
  onClose: () => void;
  onAssign: (skillId: string, tagGroupIds: string[]) => Promise<void>;
  onCreateTagGroup: (name: string) => Promise<void>;
  onSkip: () => void;
}

/**
 * 根据 tag group 名称语义选择对应 Lucide 图标。
 * 关键词匹配 → 返回最贴合的图标，否则回退到通用标签图标。
 */
function getTagGroupIcon(name: string): LucideIcon {
  const n = name.toLowerCase();
  if (/(rust|go|backend|后端|code|代码|dev|api)/.test(n)) return Code;
  if (/(react|前端|page|设计|design|ui|css|html)/.test(n)) return Palette;
  if (/(翻译|english|英文|global|i18n|lang)/.test(n)) return Globe;
  if (/(tool|工具|util|config|设置)/.test(n)) return Wrench;
  if (/(default|默认|通用)/.test(n)) return Tags;
  return Tags;
}

/**
 * Post-install prompt: optionally add a newly installed skill to one or more tag groups.
 * Supports multi-select with checkboxes and creating a new tag group inline.
 */
const AssignTagGroupDialog: React.FC<AssignTagGroupDialogProps> = React.memo(
  ({ open, skillName, skillId, tagGroups, onClose, onAssign, onCreateTagGroup, onSkip }) => {
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // 新建 tag group 状态
    const [isCreating, setIsCreating] = useState(false);
    const [newName, setNewName] = useState('');
    const [createError, setCreateError] = useState<string | null>(null);
    const [creating, setCreating] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);

    // 打开弹窗时重置状态
    useEffect(() => {
      if (open) {
        setSelected(new Set());
        setSaving(false);
        setError(null);
        setIsCreating(false);
        setNewName('');
        setCreateError(null);
      }
    }, [open]);

    // 进入创建模式后自动聚焦
    useEffect(() => {
      if (isCreating) {
        inputRef.current?.focus();
      }
    }, [isCreating]);

    const toggle = useCallback((id: string) => {
      setSelected((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
    }, []);

    const handleConfirm = useCallback(async () => {
      setSaving(true);
      setError(null);
      try {
        await onAssign(skillId, Array.from(selected));
        onClose();
      } catch (e) {
        setError(String(e));
      } finally {
        setSaving(false);
      }
    }, [skillId, selected, onAssign, onClose]);

    const handleCreate = useCallback(async () => {
      const name = newName.trim();
      if (!name) return;
      setCreating(true);
      setCreateError(null);
      try {
        await onCreateTagGroup(name);
        setNewName('');
        setIsCreating(false);
      } catch (e) {
        setCreateError(String(e));
      } finally {
        setCreating(false);
      }
    }, [newName, onCreateTagGroup]);

    const handleCreateCancel = useCallback(() => {
      setIsCreating(false);
      setNewName('');
      setCreateError(null);
    }, []);

    const handleInputKeyDown = useCallback(
      (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          void handleCreate();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          handleCreateCancel();
        }
      },
      [handleCreate, handleCreateCancel],
    );

    const isBusy = saving;

    // 按 sort_order 排序，让列表更稳定
    const sortedGroups = useMemo(
      () =>
        (Array.isArray(tagGroups) ? [...tagGroups] : []).sort(
          (a, b) => a.sort_order - b.sort_order,
        ),
      [tagGroups],
    );

    const selectedCount = selected.size;

    return (
      <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
        <DialogContent className="max-w-[380px] p-0 gap-0" showCloseButton={false}>
          {/* ── Header ── */}
          <DialogHeader className="px-4 py-3 border-b border-border">
            <div className="flex items-center justify-between">
              <DialogTitle className="text-xs font-semibold text-text-primary">
                Add to tag group
              </DialogTitle>
              <button
                type="button"
                onClick={onClose}
                className="p-1 rounded-md text-text-muted hover:text-text-primary hover:bg-bg-hover transition-colors"
                aria-label="Close dialog"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </DialogHeader>

          {/* ── Body ── */}
          <div className="px-4 py-3 space-y-3">
            <DialogDescription className="text-[11px] text-text-secondary leading-relaxed">
              <span className="font-medium text-text-primary">{skillName}</span> installed. Add it
              to tag groups so projects can load it automatically?
            </DialogDescription>

            {error && (
              <div className="text-[11px] text-accent-red bg-accent-red/10 border border-accent-red/20 rounded-md px-3 py-2">
                {error}
              </div>
            )}

            {sortedGroups.length === 0 ? (
              <div className="text-[11px] text-text-muted text-center py-5">
                No tag groups yet. Create one below or in the Skills sidebar.
              </div>
            ) : (
              <ul className="space-y-0.5 max-h-52 overflow-y-auto -mx-1 px-1">
                {sortedGroups.map((tg) => {
                  const Icon = getTagGroupIcon(tg.name);
                  const checked = selected.has(tg.id);
                  return (
                    <li key={tg.id}>
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => toggle(tg.id)}
                        className={cn(
                          'w-full flex items-center gap-2.5 px-2.5 py-2 rounded-md',
                          'text-left transition-colors',
                          'hover:bg-bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-blue',
                          checked && 'bg-bg-hover/40',
                        )}
                      >
                        {/* Checkbox */}
                        <span
                          className={cn(
                            'w-4 h-4 rounded border flex items-center justify-center shrink-0',
                            checked
                              ? 'bg-accent-blue/15 border-accent-blue text-accent-blue'
                              : 'border-border bg-transparent',
                          )}
                        >
                          {checked ? <Check className="h-2.5 w-2.5" strokeWidth={3} /> : null}
                        </span>

                        {/* 图标 */}
                        <span className="w-7 h-7 rounded-md bg-bg-tertiary flex items-center justify-center shrink-0">
                          <Icon className="h-3.5 w-3.5 text-text-secondary" />
                        </span>

                        {/* 组名 */}
                        <span className="flex-1 min-w-0 text-xs font-medium text-text-primary truncate">
                          {tg.name}
                        </span>

                        {/* 数量 */}
                        <span className="text-[11px] text-text-muted tabular-nums shrink-0">
                          {tg.skill_count}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}

            {/* ── 新建 tag group 区域 ── */}
            <div className="pt-1">
              {isCreating ? (
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <input
                      ref={inputRef}
                      type="text"
                      value={newName}
                      onChange={(e) => setNewName(e.target.value)}
                      onKeyDown={handleInputKeyDown}
                      onBlur={() => !newName.trim() && handleCreateCancel()}
                      placeholder="Tag group name"
                      disabled={creating}
                      className={cn(
                        'flex-1 h-8 px-2.5 text-xs rounded-md',
                        'bg-bg-hover/50 border border-border/80',
                        'text-text-primary placeholder:text-text-muted',
                        'outline-none focus:border-border focus:bg-bg-primary transition-colors',
                        'disabled:opacity-50',
                      )}
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      className="w-8 h-8"
                      disabled={creating || !newName.trim()}
                      onClick={() => void handleCreate()}
                      aria-label="Confirm"
                    >
                      {creating ? (
                        <span className="inline-block w-3.5 h-3.5 border-2 border-text-muted/30 border-t-text-muted rounded-full animate-spin" />
                      ) : (
                        <Check className="h-3.5 w-3.5" />
                      )}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="w-8 h-8"
                      disabled={creating}
                      onClick={handleCreateCancel}
                      aria-label="Cancel"
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                  {createError && <p className="text-[11px] text-accent-red">{createError}</p>}
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setIsCreating(true)}
                  disabled={isBusy}
                  className={cn(
                    'w-full flex items-center gap-2 px-2.5 py-2 rounded-md',
                    'text-[11px] text-text-muted hover:text-text-secondary',
                    'hover:bg-bg-hover transition-colors',
                    'disabled:opacity-50 disabled:pointer-events-none',
                  )}
                >
                  <Plus className="h-3.5 w-3.5" />
                  New tag group
                </button>
              )}
            </div>
          </div>

          {/* ── Footer ── */}
          <DialogFooter className="px-4 py-2.5 border-t border-border flex gap-2">
            <Button
              variant="secondary"
              size="sm"
              className="flex-1"
              onClick={onSkip}
              disabled={isBusy}
            >
              Skip
            </Button>
            <Button
              variant="primary"
              size="sm"
              className="flex-1 gap-1.5"
              disabled={isBusy || selectedCount === 0}
              onClick={() => void handleConfirm()}
            >
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              {selectedCount === 0
                ? 'Select groups'
                : `Add to ${selectedCount} group${selectedCount === 1 ? '' : 's'}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  },
);

AssignTagGroupDialog.displayName = 'AssignTagGroupDialog';
export default AssignTagGroupDialog;
