import type { Editor } from '@tiptap/core';
import { EditorContent, useEditor } from '@tiptap/react';
import React, { useCallback, useEffect, useMemo, useRef } from 'react';

import { registerInsertPort, unregisterInsertPort } from '@/shared/inputs/insertPorts';
import { useEditorStore } from '@/shared/store/editorStore';
import { selectActiveTabId } from '@/shared/store/editorTabSelectors';
import type { AgentChatTabData, ComposerDocJson } from '@/shared/types/tab';

import type { ComposerPaletteSource } from '../paletteSources';

import { CHIP_NODE_VIEWS } from './ChipView';
import {
  insertIntoComposer,
  registerComposerEditor,
  unregisterComposerEditor,
} from './editorRegistry';
import { buildComposerExtensions, plainTextToDoc } from './editorSchema';
import { isComposerEmpty, submitComposer } from './submitComposer';
import type { ComposerSubmission } from './submitComposer';
import { createComposerSuggestions, toSuggestionSources } from './suggestionWiring';

interface RichComposerProps {
  tabKey: string;
  tabId: string;
  /**
   * 旧纯文本草稿（textarea 时代的 `input`，design §7 迁移）。仅当 tab data 没有
   * `composerDoc` 时按纯文本恢复一次；新草稿一律写 `composerDoc`。切换稳定后
   * 该字段随旧链路一起清理。
   */
  legacyInput?: string;
  /**
   * 发送回调：prompt 纯文本（命令 chip → `/name `、文件 chip → `@path `，
   * `docToPromptText` golden 契约）+ **由文档投影出的 files 列表**
   * （`docToRequestFiles`）。附件不是独立 state，删掉 chip 就等于不再发送它。
   * 发送后编辑器自行清空（composerDoc 随 update 事件同步回 tab data）。
   */
  onSend: (submission: ComposerSubmission) => void;
  /**
   * 编辑器实例创建后回调（**仅测试**用来直接驱动实例：jsdom 下没有真实键盘，
   * `editor.commands.*` 是唯一可靠的输入注入面）。
   *
   * 生产代码**不要**用它持有编辑器 —— 所有者是 `editorRegistry`
   * （`getComposerEditor` / `insertIntoComposer`）。曾经 `ChatComposer` 自己经它
   * 存一份 `editorRef`，于是「谁持有编辑器」有了两个答案。
   */
  onReady?: (editor: Editor) => void;
  /**
   * 空内容信号（发送按钮 disabled 判据，替换 textarea 时代的
   * `input.trim().length === 0`）。是**只读投影**：由 transaction 派生，
   * 永不回写编辑器（回环闸门仍钉 `setContent` 调用次数 = 1）。
   */
  onEmptyChange?: (isEmpty: boolean) => void;
  /**
   * 弹层数据源（slash / mention，由父级经 useComposerSources 按能力位装配，
   * design §3）。缺省 = 无命令源：`/` 不触发（能力位门控，R2），`@` 出空态弹层。
   */
  sources?: readonly ComposerPaletteSource[];
}

/** 从真 store 找本 tab 的 agent-chat data（不存在的 tab / 其他 kind → null）。 */
function findAgentChatTabData(tabKey: string, tabId: string): AgentChatTabData | null {
  const tab = useEditorStore.getState().tabs[tabKey]?.tabs.find((t) => t.id === tabId);
  return tab?.data.kind === 'agent-chat' ? tab.data : null;
}

/**
 * Tiptap 富文本 composer（chip token 化的编辑面）。
 *
 * 非受控编辑器 + tab data 草稿的**单向闸门**（design §4）：`setContent` 只发生在
 * 「编辑器实例创建后恢复本 tab 草稿」这一次（按编辑器实例身份判定，StrictMode
 * 重挂载下新实例会各自恢复）；`onUpdate` → `mergeTabData({ composerDoc })` 只出不
 * 进 —— store 回流永不回写编辑器，死循环在结构上不可达。
 */
function RichComposer({
  tabKey,
  tabId,
  legacyInput,
  onSend,
  onReady,
  onEmptyChange,
  sources,
}: RichComposerProps) {
  // `handleKeyDown` 在 `useEditor(...)` 的参数里创建闭包 —— 那一刻 `editor`
  // 还没赋值（TDZ），因此必须经 ref 拿实例。这不是多余的副本：ref 的赋值点
  // 是下面的「恢复草稿」effect，与实例创建同批执行。
  const editorRef = useRef<Editor | null>(null);
  const restoredEditorRef = useRef<Editor | null>(null);

  // 回调走 ref：editorProps 闭包只创建一次，不得捕获会过期的 props。
  const onSendRef = useRef(onSend);
  const onReadyRef = useRef(onReady);
  const onEmptyChangeRef = useRef(onEmptyChange);
  useEffect(() => {
    onSendRef.current = onSend;
    onReadyRef.current = onReady;
    onEmptyChangeRef.current = onEmptyChange;
  }, [onSend, onReady, onEmptyChange]);

  // 弹层数据源经 ref 实时求值：extensions 只构建一次（identity 稳定，编辑器不
  // 因 sources 变化而 reconfigure），数据源换成引擎的 items 回调里现读。
  const sourcesRef = useRef<readonly ComposerPaletteSource[] | undefined>(undefined);
  useEffect(() => {
    sourcesRef.current = sources;
  }, [sources]);
  // ref 在引擎回调（items/command/shouldShow）中才被读取，从不在渲染期 ——
  // 闭包经 useMemo 传给 suggestion 配置会误发 react-hooks/refs（同
  // useEditorViewSnapshot 的豁免先例）。
  const getSources = useCallback(() => {
    // eslint-disable-next-line react-hooks/refs
    return toSuggestionSources(sourcesRef.current);
  }, []);
  // eslint-disable-next-line react-hooks/refs -- getSources 只在引擎回调中读 ref，从不在渲染期
  const suggestions = useMemo(() => createComposerSuggestions(getSources), [getSources]);
  const extensions = useMemo(
    () =>
      buildComposerExtensions({
        suggestions: suggestions.suggestions,
        // chip 的渲染面在这里注入（schema 层不依赖 React）。整表传入 ——
        // 新增 chip 只需在 `CHIP_SPECS` 加一条，本装配点不需要修改。
        nodeViews: CHIP_NODE_VIEWS,
      }),
    [suggestions],
  );

  const editor = useEditor({
    extensions,
    editorProps: {
      attributes: {
        class: 'rich-composer-editor',
        'aria-label': 'Message composer',
      },
      handleKeyDown: (_view, event) => {
        // IME 组合期的 Enter 属于输入法（确认候选上屏），不进入发送/换行路径。
        if (event.isComposing) return false;
        if (event.key !== 'Enter') return false;
        const current = editorRef.current;
        if (!current) return false;
        if (event.shiftKey) {
          // 弹层不消费 Shift+Enter（换行语义，PalettePopup 里显式放行），照常换行。
          current.commands.splitBlock();
          return true;
        }
        // AC7：弹层有候选时 Enter = 选中候选，让给 suggestion 引擎（它会在
        // 本事件里消费）。候选为空时弹层只消费 Escape，这里继续走发送 ——
        // 与 10-21 的空态契约等价。
        if (suggestions.controller.isPopupConsumingEnter()) return false;
        // 空内容吞掉 Enter（不产生换行），发送与清空由 submitComposer 统一负责
        submitComposer(current, onSendRef.current);
        return true;
      },
    },
  });

  // 恢复草稿：mount / 编辑器实例重建时一次（emitUpdate=false —— 恢复不回写 store）。
  // v3 的 create 事件在 setTimeout(0) 里才触发，因此 onReady / editorRef / 恢复都
  // 放在本 effect：编辑器实例与 view 在渲染期已同步创建，此处直接可用。
  // composerDoc（JSON，可逆）优先；没有才用旧纯文本草稿兜底。
  useEffect(() => {
    if (!editor || restoredEditorRef.current === editor) return;
    restoredEditorRef.current = editor;
    editorRef.current = editor;
    onReadyRef.current?.(editor);
    const data = findAgentChatTabData(tabKey, tabId);
    if (data?.composerDoc) {
      editor.commands.setContent(data.composerDoc, { emitUpdate: false });
    } else if (data && legacyInput) {
      editor.commands.setContent(plainTextToDoc(legacyInput), { emitUpdate: false });
    }
  }, [editor, tabKey, tabId, legacyInput]);

  // 草稿按 tab 持久化：只出不进。这里永不 setContent —— 回环测试断言
  // 「恢复之后 setContent 全程调用次数 = 1」钉住该不变量。
  useEffect(() => {
    if (!editor) return;
    const handleUpdate = () => {
      useEditorStore.getState().updateTab(tabKey, tabId, {
        composerDoc: editor.getJSON() as ComposerDocJson,
      });
      // 与发送前校验共用同一判据（`isComposerEmpty`）—— 否则「按钮可点但
      // 点了没反应」在只输入空格时出现。
      onEmptyChangeRef.current?.(isComposerEmpty(editor.getJSON() as ComposerDocJson));
    };
    editor.on('update', handleUpdate);
    return () => {
      editor.off('update', handleUpdate);
    };
  }, [editor, tabKey, tabId]);

  // 外部投递（拖拽文件 / prompts 面板）的落地点：编辑器实例按 (tabKey, tabId)
  // 登记，`insertIntoComposer` 命中则插入、未命中返回 false 让调用方降级。
  useEffect(() => {
    if (!editor) return;
    registerComposerEditor(tabKey, tabId, editor);
    return () => {
      unregisterComposerEditor(tabKey, tabId, editor);
    };
  }, [editor, tabKey, tabId]);

  /**
   * 插入端口登记：让**统一仲裁**（`shared/inputs/insertPorts` + `useFileDrop`）能把本
   * composer 当成一个可落地的目标。
   *
   * 插入本身复用既有注册表（`insertIntoComposer`）—— 不在这里重写一条写入路径；
   * 未挂载 / 已销毁时它返回 false，仲裁继续下一个候选（可能落到本 session 的终端）。
   * `isActive` 取布局派生的前台 tab（唯一真源 `editorTabSelectors`），不另造口径。
   */
  useEffect(() => {
    const portId = `agent-composer:${tabKey}:${tabId}`;
    registerInsertPort({
      id: portId,
      kind: 'agent-composer',
      sessionKey: tabKey,
      get el() {
        return editor && !editor.isDestroyed ? editor.view.dom : null;
      },
      isActive: () => selectActiveTabId(useEditorStore.getState(), tabKey) === tabId,
      insert: (text) => insertIntoComposer(tabKey, tabId, text),
    });
    return () => unregisterInsertPort(portId);
  }, [editor, tabKey, tabId]);

  return (
    <div className="rich-composer-root">
      {/* 滚动条由 `scrollbar-hidden` 隐掉（样式知识在 styles/base/tailwind.css，不在这里散写）。 */}
      <div className="rich-composer scrollbar-hidden">
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}

// props 均为稳定引用场景（tabKey/tabId 字符串、回调 useCallback），memo 有效。
export default React.memo(RichComposer);
