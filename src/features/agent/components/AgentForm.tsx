/**
 * AgentForm — 自定义 Agent 的编辑表单（数据对象 = AgentConfig）。
 *
 * 分组布局：身份 / CLI 执行 / 能力（CHAT + Headless）/ 部署。
 * 保存由**调用方**执行（经 `saveAgent` 统一落盘 + 刷新缓存）。
 */

import { open } from '@tauri-apps/plugin-dialog';
import React, { useCallback, useMemo, useState } from 'react';

import { cn } from '@/lib/utils';
import type { AgentConfig, WireFormat } from '@/shared/types/agent';
import { transportOf } from '@/shared/types/agent';
import { PRESET_AGENT_ICONS } from '@/shared/utils/agents';
import { Button, Input } from '@/ui';

import { importAgentIcon } from '../api/agentApi';

import { buildChatLaunch } from './agentFormChat';
import {
  buildAgentConfig,
  emptyFormState,
  toFormState,
  type ChatEnabledChoice,
  type FormState,
} from './agentFormState';
import AgentIcon from './AgentIcon';
import { trimArgList } from './argList';
import ArgListEditor from './ArgListEditor';
import BuiltinChatSection from './BuiltinChatSection';
import CapabilityBadges from './CapabilityBadges';
import ChatLaunchEditor from './ChatLaunchEditor';
import DeploySection from './DeploySection';

interface AgentFormProps {
  /** 编辑已有 Agent（缺省 = 新建）。 */
  initial?: AgentConfig | null;
  /** 提交回调 —— **负责落盘**（调用方统一走 `saveAgent`）。 */
  onSaved?: (agent: AgentConfig) => void | Promise<void>;
  onCancel?: () => void;
}

/**
 * argv 编辑器的占位符。
 *
 * **必须是模块常量**：`ArgListEditor` 包了 `React.memo`，而 memo 做的是逐 prop
 * 浅比较 —— 内联数组字面量每次渲染都是新引用，会让 memo 全程失效。把这几个
 * 字面量提到模块作用域，props 身份才稳定。
 */
const ARGS_PLACEHOLDERS = ['--flag', 'value'] as const;
const PROMPT_PLACEHOLDERS = ['-p', '--bare'] as const;
const POST_PROMPT_PLACEHOLDERS = ['--dangerously-skip-permissions'] as const;
const MODEL_LIST_PLACEHOLDERS = ['--list-models'] as const;
const CHAT_ARG_PLACEHOLDERS = ['acp'] as const;

const AgentForm: React.FC<AgentFormProps> = ({ initial, onSaved, onCancel }) => {
  const [t, setT] = useState<FormState>(() => (initial ? toFormState(initial) : emptyFormState()));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = useCallback(<K extends keyof FormState>(key: K, value: FormState[K]) => {
    setT((prev) => ({ ...prev, [key]: value }));
  }, []);

  /** chat 首行占位符取决于 `command` —— 派生而非内联，否则 memo 再次失效。 */
  const chatPlaceholders = useMemo<readonly string[]>(
    () => (t.command ? [t.command] : CHAT_ARG_PLACEHOLDERS),
    [t.command],
  );

  /**
   * 每个 argv 字段的稳定 setter。
   *
   * `React.memo(ArgListEditor)` 只有在 `onChange` 身份稳定时才省下重渲染 ——
   * 内联箭头每次渲染都是新函数，memo 会全程失效。这些 setter 依赖恒定的 `set`，
   * 因此身份也是恒定的。
   */
  const argSetters = useMemo(
    () => ({
      args: (next: string[]) => set('args', next),
      chatArgv: (next: string[]) => set('chatArgv', next),
      promptArgs: (next: string[]) => set('promptArgs', next),
      postPromptArgs: (next: string[]) => set('postPromptArgs', next),
      modelListArgs: (next: string[]) => set('modelListArgs', next),
    }),
    [set],
  );

  /**
   * CHAT 区子组件（`BuiltinChatSection` / `ChatLaunchEditor`）的稳定回调 ——
   * 与 `argSetters` 同理：两个子组件都是 `React.memo` 的，内联箭头会把 memo
   * 全程打穿。依赖恒定的 `set`，身份恒定。
   */
  const chatSetters = useMemo(
    () => ({
      chatEnabled: (next: ChatEnabledChoice) => set('chatEnabled', next),
      chatEnvText: (next: string) => set('chatEnvText', next),
      chatInprocess: (next: boolean) => set('chatInprocess', next),
      chatWireFormat: (next: WireFormat) => set('chatWireFormat', next),
    }),
    [set],
  );

  /** 提交用的 chat（`null` = 无 CHAT 能力）。预览、校验、env 显隐都复用它，
   *  避免「判据说有能力、落库却是 null」的两套语义。 */
  /** 判据来源：`is_builtin`（既有字段）。不新增 `isChatXxx` 布尔。 */
  const isBuiltinAgent = initial?.is_builtin === true;

  const builtChat = useMemo(
    () =>
      buildChatLaunch(trimArgList(t.chatArgv), t.chatEnvText, t.chatInprocess, t.chatWireFormat),
    [t.chatArgv, t.chatEnvText, t.chatInprocess, t.chatWireFormat],
  );

  /**
   * argv 识别出的传输（`null` = 无 CHAT 能力）—— **只算一次**：模型目录判据、
   * 子组件展示都从这一份派生，不再各自重复解析同一份 argv。
   */
  const transport = useMemo(() => (builtChat ? transportOf(builtChat) : null), [builtChat]);

  /**
   * 内置 agent 的**出厂**协议 —— 从 `initial.chat` 识别，**不经过投影**：
   * inprocess 出厂 chat（mockAgent）的投影是空 argv，会被误判成「无协议」。
   * 依赖整个 `initial`（React Compiler 的推断粒度，窄化会报错）。
   */
  const builtinTransport = useMemo(
    () => (initial?.chat ? transportOf(initial.chat) : null),
    [initial],
  );

  /** 能力预览 —— `chat` 直接取提交值的真值，不存在第二套判据。 */
  const preview = useMemo(
    () => ({
      cli: t.command.trim().length > 0,
      chat: builtChat !== null,
      headless: trimArgList(t.promptArgs).length > 0,
    }),
    [t.command, t.promptArgs, builtChat],
  );

  /**
   * 该 agent 的 chat 传输是否**自带会话内模型目录**（`SessionConfig`）。
   *
   * ACP 与 PiRpc 都属此类：模型列表由协议在会话握手时下发，id 是裸名。
   * 此时 CLI 旁路（`model_list_args`）必须关闭 —— 它给的是 `provider/model`
   * 复合串，写回 `set_config_option` 会被拒（spec §10.5b 实测事故）。
   *
   * 注意判据**不是**「能否选模型」：`serve`（`PerTurn`）也能选模型，但它的
   * CLI 目录形状恰好与写回通道一致，必须保留（spec §10.5c）。
   */
  const chatIsSessionScoped = useMemo(
    () => transport === 'acp' || transport === 'pi-rpc',
    [transport],
  );

  /** 组装提交用的 AgentConfig：纯映射在 `agentFormState.buildAgentConfig`
   *  （组件文件受 ratchet 约束，投影函数与 React 无关，落同一族文件）。 */
  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setError(null);
      if (!t.id.trim()) {
        setError('Agent ID is required (lowercase letters, numbers, hyphens)');
        return;
      }
      if (!t.name.trim()) {
        setError('Agent name is required');
        return;
      }
      if (!t.command.trim() && builtChat === null) {
        setError('Requires at least one of Command (CLI) or CHAT capability');
        return;
      }
      setSaving(true);
      try {
        // 写路径归调用方（它才知道内置/自定义，也只有它能统一走 `saveAgent`）。
        // 表单自己调 `addAgent` 会造成一次保存两次 `add_agent`。
        await onSaved?.(buildAgentConfig(t, initial, builtChat));
      } catch (err) {
        setError(String(err));
      } finally {
        setSaving(false);
      }
    },
    [t, onSaved, initial, builtChat],
  );

  const handleUploadIcon = useCallback(async () => {
    try {
      const selected = await open({
        multiple: false,
        filters: [
          {
            name: 'Images',
            extensions: ['png', 'jpg', 'jpeg', 'svg', 'gif', 'webp', 'ico', 'bmp'],
          },
        ],
      });
      if (!selected) return;
      const iconPath = await importAgentIcon(selected);
      set('icon', iconPath);
    } catch (err) {
      console.error('[AgentForm] Failed to upload icon:', err);
    }
  }, [set]);

  const labelCls = 'text-[0.72em] text-text-muted font-medium';
  const groupCls = 'flex flex-col gap-1.5';
  const sectionTitle = 'text-[0.75em] font-semibold text-text-secondary uppercase tracking-wider';

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      {/* ── Header: title + capability preview ─────────────────────────── */}
      <div className="flex items-center justify-between gap-2">
        <div className="text-[0.86em] font-semibold text-text-primary">
          {initial
            ? initial.is_builtin
              ? `Edit Built-in Agent · ${initial.id}`
              : `Edit Agent · ${initial.id}`
            : 'Create Custom Agent'}
        </div>
        <CapabilityBadges
          agent={{
            command: preview.cli ? t.command : '',
            chat: builtChat,
            prompt_args: preview.headless ? [] : null,
          }}
        />
      </div>

      {initial?.is_builtin && (
        <div className="text-[0.72em] text-text-muted bg-bg-secondary/50 border border-border/60 rounded px-2 py-1">
          Edits are saved as an override. Use Reset in the settings list to restore the factory
          default.
        </div>
      )}

      {error && (
        <div className="text-[0.78em] text-accent-red bg-accent-red/10 border border-accent-red/20 px-2 py-1 rounded">
          {error}
        </div>
      )}

      {/* ── Identity ──────────────────────────────────────────────────── */}
      <div className="border border-border rounded-lg bg-bg-primary overflow-hidden">
        <div className={cn(sectionTitle, 'px-3 pt-2 pb-1.5 bg-bg-secondary/40')}>Identity</div>
        <div className="p-3 pt-2 grid grid-cols-2 gap-2">
          <div className={groupCls}>
            <label className={labelCls} htmlFor="agent-form-id">
              ID *
            </label>
            <Input
              id="agent-form-id"
              size="sm"
              value={t.id}
              disabled={Boolean(initial)}
              onChange={(e) => set('id', e.target.value.trim())}
              placeholder="my-agent"
            />
          </div>
          <div className={groupCls}>
            <label className={labelCls} htmlFor="agent-form-name">
              Name *
            </label>
            <Input
              id="agent-form-name"
              size="sm"
              value={t.name}
              onChange={(e) => set('name', e.target.value)}
              placeholder="My Agent"
            />
          </div>
        </div>
        <div className="px-3 pb-3 -mt-1 flex items-center gap-2">
          <span className={labelCls}>Icon:</span>
          <div className="flex items-center gap-1 flex-wrap">
            {PRESET_AGENT_ICONS.map((iconName) => (
              <button
                key={iconName}
                type="button"
                className={cn(
                  'size-6 rounded flex items-center justify-center border transition-colors',
                  t.icon === iconName
                    ? 'border-accent-blue bg-accent-blue/10'
                    : 'border-transparent hover:bg-bg-hover',
                )}
                onClick={() => set('icon', iconName)}
                title={iconName}
              >
                <AgentIcon icon={iconName} size={14} className="size-3.5 object-contain" />
              </button>
            ))}
            <span className="text-text-muted mx-0.5 select-none">|</span>
            <button
              type="button"
              className="text-[0.75em] text-accent-blue hover:underline px-1 py-0.5"
              onClick={handleUploadIcon}
              title="Upload custom icon"
            >
              Upload
            </button>
          </div>
        </div>
      </div>

      {/* ── CLI Execution ────────────────────────────────────────────── */}
      <div className="border border-border rounded-lg bg-bg-primary overflow-hidden">
        <div className={cn(sectionTitle, 'px-3 pt-2 pb-1.5 bg-bg-secondary/40')}>CLI Execution</div>
        <div className="p-3 pt-2 grid grid-cols-2 gap-2">
          <div className={groupCls}>
            <label className={labelCls} htmlFor="agent-form-command">
              Command * (terminal TUI launch)
            </label>
            <Input
              id="agent-form-command"
              size="sm"
              value={t.command}
              onChange={(e) => set('command', e.target.value)}
              placeholder="myagent"
            />
          </div>
          <div className={groupCls}>
            <span className={labelCls}>Args (one per line)</span>
            <ArgListEditor
              value={t.args}
              onChange={argSetters.args}
              placeholders={ARGS_PLACEHOLDERS}
            />
          </div>
        </div>
        <div className="px-3 pb-3 -mt-0.5">
          <span className="text-[0.7em] text-text-muted">
            Leave Command empty for no CLI capability (e.g. in-process CHAT-only agents).
          </span>
        </div>
      </div>

      {/* ── Capabilities: CHAT + Headless ────────────────────────────── */}
      <div className="border border-border rounded-lg bg-bg-primary overflow-hidden">
        <div className={cn(sectionTitle, 'px-3 pt-2 pb-1.5 bg-bg-secondary/40')}>Capabilities</div>
        <div className="p-3 pt-2 flex flex-col gap-2">
          {isBuiltinAgent ? (
            <BuiltinChatSection
              transport={builtinTransport}
              value={t.chatEnabled}
              onChange={chatSetters.chatEnabled}
              groupCls={groupCls}
              labelCls={labelCls}
            />
          ) : (
            <ChatLaunchEditor
              argv={t.chatArgv}
              onArgvChange={argSetters.chatArgv}
              envText={t.chatEnvText}
              onEnvTextChange={chatSetters.chatEnvText}
              inprocess={t.chatInprocess}
              onInprocessChange={chatSetters.chatInprocess}
              wireFormat={t.chatWireFormat}
              onWireFormatChange={chatSetters.chatWireFormat}
              transport={transport}
              hasChat={builtChat !== null}
              placeholders={chatPlaceholders}
              groupCls={groupCls}
              labelCls={labelCls}
            />
          )}
          <div className="grid grid-cols-2 gap-2">
            <div className={groupCls}>
              <span className={labelCls}>Prompt Args (Headless · one per line)</span>
              <ArgListEditor
                value={t.promptArgs}
                onChange={argSetters.promptArgs}
                placeholders={PROMPT_PLACEHOLDERS}
              />
            </div>
            <div className={groupCls}>
              <span className={labelCls}>Post Prompt Args (one per line)</span>
              <ArgListEditor
                value={t.postPromptArgs}
                onChange={argSetters.postPromptArgs}
                placeholders={POST_PROMPT_PLACEHOLDERS}
              />
            </div>
            <div className={groupCls}>
              {chatIsSessionScoped ? (
                <>
                  <span className={labelCls}>List Models Args</span>
                  <p className="text-[0.7em] text-text-muted leading-relaxed">
                    The model list comes from the agent protocol. A CLI list would return
                    <code className="mx-1 font-mono">provider/model</code>
                    ids that cannot be written back, so this field is disabled here.
                  </p>
                </>
              ) : (
                <>
                  <span className={labelCls}>List Models Args (one per line)</span>
                  {/* 空列表时编辑器不渲染输入框（只有「+ Add」），所以用容器
                      上的 `aria-label` 作为「该字段存在」的可定位判据。 */}
                  <div role="group" aria-label="List Models Args">
                    <ArgListEditor
                      value={t.modelListArgs}
                      onChange={argSetters.modelListArgs}
                      placeholders={MODEL_LIST_PLACEHOLDERS}
                    />
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      <DeploySection t={t} set={set} />

      {/* ── Footer: enabled + actions ────────────────────────────────── */}
      <div className="flex items-center justify-between gap-2">
        <label className="flex items-center gap-2 text-[0.82em] text-text-secondary cursor-pointer">
          <input
            type="checkbox"
            checked={t.enabled}
            onChange={(e) => set('enabled', e.target.checked)}
            className="accent-accent-blue size-3.5"
          />
          Enabled
        </label>
        <div className="flex gap-2">
          {onCancel && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onCancel}
              className="text-[0.82em]"
            >
              Cancel
            </Button>
          )}
          <Button
            type="submit"
            variant="primary"
            size="sm"
            disabled={saving}
            className="text-[0.82em]"
          >
            {saving ? 'Saving…' : initial ? 'Save Agent' : 'Create Agent'}
          </Button>
        </div>
      </div>
    </form>
  );
};

export default React.memo(AgentForm);
