import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { runAiQuickFixAction } from '../api/codeAction';
import type { QuickFixMenuItem } from '../api/codeAction';
import { useDiagnosticQuickFix } from '../hooks/useDiagnosticQuickFix';
import type { LspDiagnostic } from '../types';

import { QuickFixBulbIcon, QuickFixSparkleIcon } from './QuickFixBulbIcon';
import { firstEnabledIndex, flattenMenuItems, stepEnabledIndex } from './quickFixMenuNav';
import { computeMenuPosition } from './quickFixMenuPosition';

interface DiagnosticQuickFixProps {
  projectPath: string;
  /** null = 扩展名识别不出语言 → 不显示灯泡（避免点了必然失败的入口）。 */
  languageId: string | null;
  uri: string;
  diagnostic: LspDiagnostic;
}

/**
 * 诊断行的 quickfix 入口（VS Code 灯泡同构）：hover 显形 → 点击拉 codeAction →
 * 列表选中即应用。
 *
 * 菜单走 **portal + fixed 定位**：Problems 面板是 `overflow-y-auto` 的滚动容器，
 * 行内绝对定位的菜单会被容器裁掉（"下拉列表被遮挡"）。portal 到 body 后按视口
 * 计算位置——下方放不下就翻到上方，水平夹紧在视口内，并给 max-height 让长列表
 * 内部滚动。
 *
 * 独立成组件的另两个原因：① DiagnosticsPanel 已有 196 行，灯泡逻辑内联会逼近
 * 300 行红线；② 状态机（拉取 / 应用 / 关闭）与行渲染无关，可单独测试。
 */
export function DiagnosticQuickFix({
  projectPath,
  languageId,
  uri,
  diagnostic,
}: DiagnosticQuickFixProps) {
  const { open, busy, sections, toggle, apply, close } = useDiagnosticQuickFix({
    projectPath,
    languageId,
    uri,
    diagnostic,
  });
  // 摊平下标是键盘高亮的唯一坐标系（跨组连续移动）—— 与编辑器内菜单同一套规则
  const flatItems = useMemo(() => flattenMenuItems(sections), [sections]);
  /** 条目选中（点击 / Enter 共用）：AI 动作派发注册表，服务器动作按标题应用。 */
  const pick = useCallback(
    (item: QuickFixMenuItem) => {
      if (item.ai) {
        // B1：agent 自己改文件；没落地（编辑器未打开）时菜单保持打开让用户看到
        if (runAiQuickFixAction(uri, diagnostic, item.ai)) close();
        return;
      }
      apply(item.title);
    },
    [uri, diagnostic, close, apply],
  );
  // 键盘高亮：`null` = 尚未手动移动 → 派生为"服务器声明的首选/首个可执行项"。
  // 用派生而不是在 effect 里 setState（后者会多一轮渲染，且被 react-hooks 规则拦下）。
  const [navIndex, setNavIndex] = useState<number | null>(null);
  const activeIndex = navIndex ?? (open ? firstEnabledIndex(flatItems) : -1);
  // 键盘处理函数在事件里读 ref：↑↓ 与 Enter 连续按下时，若读 useState 闭包值会拿到
  // 上一轮渲染的旧下标（当次按键白按）。ref 的写入放在 effect 里（渲染期写 ref 违规）。
  const activeIndexRef = useRef(activeIndex);
  useEffect(() => {
    activeIndexRef.current = activeIndex;
  }, [activeIndex]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        close();
        return;
      }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const current = activeIndexRef.current;
        const moved = stepEnabledIndex(flatItems, current, e.key === 'ArrowDown' ? 1 : -1);
        if (moved !== current) {
          activeIndexRef.current = moved;
          setNavIndex(moved);
        }
        return;
      }
      const index = activeIndexRef.current;
      if (e.key === 'Enter' && index >= 0) {
        const item = flatItems[index];
        if (item && !item.disabledHint) {
          e.preventDefault();
          pick(item);
        }
      }
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [open, close, flatItems, pick]);

  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  // 定位：先以 visibility:hidden 渲染，量到真实尺寸后再摆位（避免二次渲染闪烁）
  useLayoutEffect(() => {
    if (!open) return;
    const button = buttonRef.current;
    const menu = menuRef.current;
    if (!button || !menu) return;

    // 定位规则只有一份实现（编辑器内的 CM6 菜单共用同一个纯函数）
    const { top, left, maxHeight } = computeMenuPosition(
      button.getBoundingClientRect(),
      { width: menu.offsetWidth, height: menu.offsetHeight },
      { width: window.innerWidth, height: window.innerHeight },
    );
    menu.style.top = `${top}px`;
    menu.style.left = `${left}px`;
    menu.style.maxHeight = `${maxHeight}px`;
    menu.style.visibility = 'visible';
  }, [open, busy, sections]);

  // 关闭时机：点外部 / Esc / 滚动或缩放（菜单是 fixed，滚动后与行错位，直接关掉）
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (menuRef.current?.contains(target) || buttonRef.current?.contains(target)) return;
      close();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    window.addEventListener('resize', close);
    window.addEventListener('scroll', close, true);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('resize', close);
      window.removeEventListener('scroll', close, true);
    };
  }, [open, close]);

  if (!languageId) return null;

  return (
    // 与诊断行是**兄弟**节点（行跳转的 onClick 在相邻 button 上），所以点击灯泡
    // 天然不会触发跳转，无需 stopPropagation；菜单 portal 到 body 更不受影响。
    <span className="inline-flex shrink-0">
      <button
        ref={buttonRef}
        type="button"
        data-testid="diagnostic-quickfix-button"
        aria-haspopup="menu"
        aria-expanded={open}
        title="Quick Fix"
        onClick={() => {
          // 每次打开都回到"未手动移动"状态，高亮重新落在首选/首个可执行项
          setNavIndex(null);
          void toggle();
        }}
        className="opacity-0 group-hover:opacity-100 focus:opacity-100 p-0.5 rounded hover:bg-[var(--bg-hover)] transition-opacity text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer"
      >
        <QuickFixBulbIcon size={13} />
      </button>

      {open &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            data-testid="diagnostic-quickfix-menu"
            style={{ visibility: 'hidden' }}
            className="fixed z-50 min-w-40 max-w-64 overflow-y-auto rounded-md border border-[var(--border-color)] bg-[var(--bg-secondary)] text-[var(--text-primary)] shadow-[0_8px_24px_oklch(0_0_0/0.5)] text-[11.5px]"
          >
            {busy && (
              <div
                className="px-2.5 py-1.5 text-[var(--text-muted)]"
                data-testid="diagnostic-quickfix-loading"
              >
                Loading…
              </div>
            )}
            {flatItems.map((item, itemIndex) => (
              <button
                key={item.ai ?? item.title}
                type="button"
                role="menuitem"
                data-testid={
                  item.ai
                    ? `diagnostic-quickfix-ai-${item.ai}`
                    : `diagnostic-quickfix-${item.title}`
                }
                disabled={Boolean(item.disabledHint)}
                title={item.disabledHint}
                onClick={() => pick(item)}
                onMouseEnter={() => !item.disabledHint && setNavIndex(itemIndex)}
                className={`w-full flex items-center gap-2 px-2.5 py-[5px] text-left border-b border-[var(--border-color)] last:border-b-0 hover:bg-[var(--bg-hover)] disabled:cursor-default disabled:text-[var(--text-muted)] cursor-pointer ${
                  itemIndex === activeIndex ? 'bg-[var(--bg-hover)]' : ''
                }`}
              >
                {!item.disabledHint &&
                  (item.ai ? (
                    // AI 动作（✨ Fix / ✨ Explain）：sparkle 区分来源
                    <QuickFixSparkleIcon size={12} className="shrink-0 text-[var(--accent-blue)]" />
                  ) : (
                    <QuickFixBulbIcon size={12} className="shrink-0 text-[var(--accent-yellow)]" />
                  ))}
                {/* 可执行项标题在 <code> 里；置灰项是普通文本（当前不产出，保留通用分支） */}
                {item.disabledHint ? (
                  <span className="min-w-0 flex-1 truncate">{item.title}</span>
                ) : (
                  <code className="min-w-0 flex-1 truncate font-mono text-[11px] text-[var(--cm-string)]">
                    {item.title}
                  </code>
                )}
                {(item.disabledHint ?? item.hint) && (
                  <span className="ml-auto shrink-0 text-[10.5px] text-[var(--text-muted)]">
                    {item.disabledHint ?? item.hint}
                  </span>
                )}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </span>
  );
}
