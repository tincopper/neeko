/** 自定义 LSP 服务器：列表 + 新增/编辑表单（自持 IME guard，纯受控于父级 props）。 */

import type { Dispatch, SetStateAction } from 'react';

import type { CustomLspServerConfig, LspAutoStart } from '@/features/settings/types';
import { useImeSpaceGuard } from '@/shared/hooks/useImeSpaceGuard';
import { Button, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/ui';

import { emptyDraftForm, serverToDraftForm, type ServerDraftForm } from './lspServerDraft';
import { Field } from './SettingRow';

interface Props {
  servers: CustomLspServerConfig[];
  draft: ServerDraftForm | null;
  setDraft: Dispatch<SetStateAction<ServerDraftForm | null>>;
  saving: boolean;
  error: string | null;
  /** 取消编辑时清空错误（父级持有 error 状态）。 */
  setError: (value: string | null) => void;
  onSaveDraft: () => Promise<void>;
  onRemove: (id: string) => Promise<void>;
}

export default function LspCustomServersSection({
  servers,
  draft,
  setDraft,
  saving,
  error,
  setError,
  onSaveDraft,
  onRemove,
}: Props) {
  const guard = useImeSpaceGuard<HTMLTextAreaElement>();
  const isEditing = draft != null && servers.some((s) => s.id === draft.id);

  return (
    <div className="flex flex-col items-start gap-3 py-3 mt-2 border-b border-white/[0.04] last:border-b-0">
      <div className="flex w-full items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="text-[0.86em] text-text-primary font-medium mb-0.75">Custom servers</div>
          <div className="text-[0.79em] text-text-muted leading-relaxed">
            Bind extra file extensions to a language server command. Extensions take priority over
            built-ins.
          </div>
        </div>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={saving || draft != null}
          onClick={() => setDraft(emptyDraftForm())}
        >
          Add server
        </Button>
      </div>

      {servers.length > 0 && (
        <div className="w-full border border-border rounded overflow-hidden bg-bg-primary">
          {servers.map((s, idx) => (
            <div
              key={s.id}
              className={
                idx < servers.length - 1
                  ? 'flex items-center gap-2.5 py-[7px] px-3 border-b border-white/[0.03] text-[0.86em]'
                  : 'flex items-center gap-2.5 py-[7px] px-3 text-[0.86em]'
              }
            >
              <div className="flex flex-col min-w-0 flex-1 gap-0.5">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-text-primary font-medium truncate">
                    {s.displayName || s.languageId}
                  </span>
                  <span className="text-text-muted text-[0.82em] shrink-0 font-mono">
                    {s.languageId}
                  </span>
                </div>
                <div className="text-text-muted font-mono text-[0.82em] truncate">
                  {s.command.join(' ')}
                  <span className="text-text-muted/80">
                    {' · '}
                    {s.file_extensions.map((e) => `*.${e}`).join(', ')}
                  </span>
                </div>
              </div>
              <button
                type="button"
                className="bg-none border-none text-text-muted cursor-pointer text-[0.79em] py-0.5 px-1.5 rounded shrink-0 hover:text-text-primary hover:bg-bg-hover"
                onClick={() => setDraft(serverToDraftForm(s))}
                title="Edit"
              >
                Edit
              </button>
              <button
                type="button"
                className="bg-none border-none text-text-muted cursor-pointer text-[0.79em] py-0.5 px-1 rounded shrink-0 hover:text-status-error hover:bg-bg-hover"
                onClick={() => void onRemove(s.id)}
                title="Remove"
              >
                &times;
              </button>
            </div>
          ))}
        </div>
      )}

      {servers.length === 0 && !draft && (
        <div className="w-full rounded border border-dashed border-border/80 bg-bg-primary/40 px-3 py-4 text-center text-[0.79em] text-text-muted">
          No custom servers yet. Example: bind{' '}
          <span className="font-mono text-text-secondary">proto</span> to{' '}
          <span className="font-mono text-text-secondary">buf beta lsp</span>.
        </div>
      )}

      {draft && (
        <div className="w-full rounded-md border border-border bg-bg-primary p-3.5 flex flex-col gap-3">
          <div className="text-[0.86em] text-text-primary font-medium">
            {isEditing ? 'Edit server' : 'New server'}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Language ID">
              <Input
                value={draft.languageId}
                onChange={(e) => setDraft({ ...draft, languageId: e.target.value })}
                placeholder="protobuf"
                className="h-9 py-1.5 text-[0.86em]"
                autoComplete="off"
              />
            </Field>
            <Field label="Display name">
              <Input
                value={draft.displayName}
                onChange={(e) => setDraft({ ...draft, displayName: e.target.value })}
                placeholder="Buf LSP"
                className="h-9 py-1.5 text-[0.86em] !font-sans"
                autoComplete="off"
              />
            </Field>
          </div>

          <Field label="Command" hint="Space-separated arguments, e.g. buf beta lsp or gopls">
            <Input
              value={draft.commandText}
              onChange={(e) => setDraft({ ...draft, commandText: e.target.value })}
              placeholder="buf beta lsp"
              className="h-9 py-1.5 text-[0.86em]"
              autoComplete="off"
              data-form-type="other"
            />
          </Field>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="File extensions" hint="Comma-separated, without dots, e.g. proto, pb">
              <Input
                value={draft.extensionsText}
                onChange={(e) => setDraft({ ...draft, extensionsText: e.target.value })}
                placeholder="proto, pb"
                className="h-9 py-1.5 text-[0.86em] !font-sans"
                autoComplete="off"
                data-form-type="other"
              />
            </Field>
            <Field
              label="Root markers (optional)"
              hint="Comma-separated filenames, e.g. buf.yaml, go.mod"
            >
              <Input
                value={draft.rootMarkersText}
                onChange={(e) => setDraft({ ...draft, rootMarkersText: e.target.value })}
                placeholder="buf.yaml"
                className="h-9 py-1.5 text-[0.86em] !font-sans"
                autoComplete="off"
                data-form-type="other"
              />
            </Field>
          </div>

          <Field label="Auto-start">
            <Select
              value={draft.autoStart}
              onValueChange={(value) => setDraft({ ...draft, autoStart: value as LspAutoStart })}
            >
              <SelectTrigger className="h-9 text-[0.86em] bg-bg-tertiary">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="onFirstFile">On first file</SelectItem>
                <SelectItem value="onProjectSelect">On project select</SelectItem>
                <SelectItem value="manual">Manual</SelectItem>
              </SelectContent>
            </Select>
          </Field>

          <Field
            label="initializationOptions (optional)"
            hint='JSON passed to the server on initialize, e.g. {"hoverKind":"FullDocumentation"}'
          >
            <textarea
              value={draft.initializationOptionsText}
              onChange={(e) => setDraft({ ...draft, initializationOptionsText: e.target.value })}
              onCompositionEnd={(e) => {
                guard.onCompositionEnd(e);
              }}
              placeholder='{"hoverKind": "FullDocumentation"}'
              rows={3}
              className="w-full min-h-[72px] rounded-md border border-border bg-bg-tertiary px-3 py-2 text-[0.86em] font-mono text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-accent-blue resize-y"
              spellCheck={false}
              autoComplete="off"
              data-form-type="other"
            />
          </Field>

          {error && <p className="text-[0.79em] text-status-error leading-relaxed">{error}</p>}

          <div className="flex items-center justify-end gap-2 pt-1">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setDraft(null);
                setError(null);
              }}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="primary"
              size="sm"
              disabled={saving}
              onClick={() => void onSaveDraft()}
            >
              {saving ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
