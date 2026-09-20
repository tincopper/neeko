import { forEachDiagnostic } from '@codemirror/lint';
import { RangeSet } from '@codemirror/state';
import type { Extension } from '@codemirror/state';
import { GutterMarker, gutter } from '@codemirror/view';
import type { KeyBinding } from '@codemirror/view';

import { BULB_SVG_MARKUP } from '../components/QuickFixBulbIcon';

import {
  applyPreferredFixAt,
  openQuickFixAt,
  runAiFixAt,
  viewProblemAt,
  type LspQuickFixContext,
} from './quickFixMenuActions';

/**
 * 编辑器内 quickfix 的 gutter + 键位层：有诊断的行首灯泡（点击开菜单）与
 * `Alt-Enter` / `Mod-.` / `Mod-i` / `F2` 键位（见 `quickFixKeyBindings`）。
 */
export function quickFixKeyBindings(ctx: LspQuickFixContext): KeyBinding[] {
  return [
    // 与 tooltip 上的提示一一对应（VS Code 形态）
    { key: 'Alt-Enter', run: (view) => openQuickFixAt(view, ctx) },
    { key: 'Mod-.', run: (view) => applyPreferredFixAt(view, ctx) },
    // AI Fix（✨）：与 Mod-.（服务器首选）并存 —— B1：agent 自己改文件
    { key: 'Mod-i', run: (view) => runAiFixAt(view, ctx) },
    {
      key: 'F2',
      // 不依赖 view：只展开 Problems 面板
      run: () => {
        viewProblemAt(ctx);
        return true;
      },
    },
  ];
}

/** 灯泡 gutter 标记（VS Code 同构：只在有诊断的行显示）。 */
class QuickFixBulbMarker extends GutterMarker {
  toDOM(): Node {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'cm-neeko-quickfix-bulb';
    el.title = 'Quick Fix…';
    el.setAttribute('aria-label', 'Quick Fix');
    // gutter 里是原生 DOM（不经过 React/Tailwind），不给内联样式会渲染成浏览器默认灰按钮
    el.style.cssText = [
      'display:flex',
      'align-items:center',
      'justify-content:center',
      'width:14px',
      'height:14px',
      'padding:0',
      'border:none',
      'background:transparent',
      'color:inherit',
      'cursor:pointer',
    ].join(';');
    // 与菜单共用同一份 path（原型 #i-bulb）；gutter 里是原生 DOM，故用字符串版
    el.innerHTML = BULB_SVG;
    return el;
  }
}

const bulbMarker = new QuickFixBulbMarker();

/** 行内灯泡图标：与 React 侧共用同一份 path（原型 #i-bulb）。 */
const BULB_SVG = BULB_SVG_MARKUP;

/** 有诊断的行首灯泡；点击在该行打开 quickfix。 */
export function quickFixGutter(ctx: LspQuickFixContext): Extension {
  return gutter({
    class: 'cm-neeko-quickfix-gutter',
    markers: (view) => {
      const seen = new Set<number>();
      const ranges: ReturnType<GutterMarker['range']>[] = [];
      forEachDiagnostic(view.state, (diagnostic) => {
        // 原型 M3-1：灯泡只在**红色（error）诊断**行出现
        if (diagnostic.severity !== 'error') return;
        // 同一位置多条诊断只放一个灯泡
        if (seen.has(diagnostic.from)) return;
        seen.add(diagnostic.from);
        ranges.push(bulbMarker.range(diagnostic.from));
      });
      return RangeSet.of(ranges, true);
    },
    domEventHandlers: {
      mousedown: (view, line) => openQuickFixAt(view, ctx, line.from),
    },
  });
}
