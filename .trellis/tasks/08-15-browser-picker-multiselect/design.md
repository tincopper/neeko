# 设计：浏览器元素选择器与 AI 输入框优化（支持多选）

## 1. 背景与现状

选取流程分三层：

1. **注入脚本** `src-tauri/src/browser/picker_script.js`（自包含 IIFE，经 `include_str!` 随 `browser_start_picker` 注入 webview）。
2. **协议回传** `src-tauri/src/browser/uri_scheme.rs`：页面 `fetch POST neeko://<type>`，`parse_picker_payload` 解析，`handle_picker_message` 分发给前端事件。
3. **前端编排** `src/features/browser/hooks/useBrowserPanel.ts` 监听 `browser://prompt-submitted` → 校验 Agent CLI tab → `formatPickerMessage` 组装文本 → `sendToTerminal`。

现状缺陷（见 PRD）：高亮弱、无选中锁定、无多选、Composer 裸样式、无发送按钮/元素上下文、关闭语义错误、发送后 1.5s 延迟清理竞态。

## 2. 设计目标

- 注入脚本内部实现「单选/多选 + 锁定 + Composer」全部 UI，主题色走 `__NEEKO_THEME__`。
- **协议升级**：`PromptSubmitted` 由单 `html` 改为元素数组，多选一次回传。
- 前端/Rust 消息结构、测试同步（Breaking Change，一次性迁移）。
- **UI 文案统一英文**（与已批准原型一致），中文仅保留在开发者注释。

## 3. 数据流

```
注入脚本 (picker_script.js)
  ├─ hover → rAF 节流 → .neeko-hover 高亮 + tooltip chip
  ├─ 单选 click → 锁定 .neeko-selected + 角标 + 操作条 → openComposer（1 个 chip）
  ├─ 多选 click → multiSel 累加/取消 → 编号徽标 + Composer chips 实时更新（首个选中即弹 Composer）
  ├─ 模式药丸开关（Composer 底部）⇄ Single/Multi 切换
  └─ send → POST neeko://prompt-submitted
        body: { type, prompt, elements: [{ html, selector }] }
              ↑ 原为 { type, prompt, html }
Rust uri_scheme.rs
  └─ parse_picker_payload → PickerMessage::PromptSubmitted { prompt, elements }
       └─ emit browser://prompt-submitted { prompt, elements }
前端 useBrowserPanel.ts
  ├─ PromptSubmittedPayload { prompt, elements: PickerElement[] }
  ├─ 守卫：未选中 Agent CLI tab → toast + reinjectPicker
  └─ formatPickerMessage(prompt, elements, url) → sendToTerminal(... + '\r')
```

## 4. 协议结构（Breaking Change）

### 4.1 POST body（注入脚本 → Rust）

```jsonc
// 单选：elements 长度 1；多选：长度 N
{
  "type": "prompt-submitted",
  "prompt": "把按钮改为绿色圆角",
  "elements": [
    { "html": "<button id=\"navCta\" ...>...</button>", "selector": "button#navCta" },
    { "html": "<div class=\"card\" ...>...</div>", "selector": "div.card" }
  ]
}
```

- `selector` 由注入脚本 `getSelector()` 生成（tag + #id + 前两个 class）。
- 保持 `element-picked`（剪贴板）与 `picker-cancelled` 通道不变。

### 4.2 Rust 侧

```rust
pub enum PickerMessage {
    PromptSubmitted {
        prompt: String,
        elements: Vec<PickerElement>,   // 原 html: String
    },
    PickerCancelled,
    ElementPicked { html: String },
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct PickerElement {
    pub html: String,
    pub selector: String,
}
```

- `parse_picker_payload` 解析 `elements` 数组：缺数组 / 数组空 / 元素缺 `html` 一律返回 `None`。
- 保留 `DEDUP_WINDOW_MS` 去重窗口；emit payload `{ "prompt", "elements" }`。

### 4.3 前端侧

```ts
interface PickerElement { html: string; selector: string; }
interface PromptSubmittedPayload { prompt: string; elements: PickerElement[]; }
```

- `formatPickerMessage(prompt, elements: PickerElement[], browserUrl)`：改为对每个元素输出编号 + `selector` + 代码块 outerHTML：

```
Please modify the following page elements:

@{url}

Requirement: {prompt}

Element 1 (button#navCta):
```html
<button id="navCta" ...>
```

Element 2 (div.card):
```html
<div class="card" ...>
```
```

## 5. 注入脚本状态模型

```js
var S = {
  mode: 'single' | 'multi',   // 初始 single
  hoverEl,            // 当前 hover 元素
  selectedEl,         // 单选锁定
  multiSel: [],       // 多选数组（保序、去重）
  mouseX, mouseY, rAF, oldCursor
};
```

覆盖层元素（均 `position:fixed`，z-index 2147483644+，主题色取自 `C`）：
- `#modePill`：顶部居中，**纯被动指示**（`●` + 当前模式 + Esc 提示，`pointer-events:none`，不含切换按钮）。
- `#pickTip`：跟随鼠标 chip，`pointer-events:none`。
- 徽标：单选四角（tag/尺寸）、多选编号 `numBadge`（top-left）。
- `#selBar`：单选操作条（Parent/Child/Copy HTML）。
- `#composer`：底部居中 AI 输入框 —— 顶部为所选元素 chips 行（`cc-chip`：编号 + selector + 尺寸 + ✕ 单移）+ ✕ 关闭；中部 textarea；底部为提示 + **单颗 `⇄ Single/Multi` 药丸开关** + Send 按钮。
- **无独立托盘**：多选元素直接以 chips 内嵌 Composer 显示。

## 6. 关键交互规则

- **点击事件**：注入脚本在 document capture 注册 `onClick`。对「选择器自身覆盖层」`isUIEl(t)` 直接 `return`，**不 stopPropagation**（否则 capture 截断会让 Pill/Composer/操作条按钮收不到点击 —— 已踩坑）。对页面元素 `preventDefault + stopPropagation` 再处理。
- **多选**：`toggleMulti` 按 `indexOf` 判定加/减；编号徽标与 Composer chips（`renderChips`）随 `multiSel` 重渲染。**首个元素选中即 `openComposer()`**，后续点击实时更新 chips（不丢已输入 prompt）。
- **chips 单移**：`removeChip(i)` —— 多选移除第 i 个并重排编号；单选移除即清空并关闭。最后一个移除后自动 `closeComposer()`（避免空 Composer 死路）。
- **模式切换（药丸开关）**：单→多把当前锁定元素带入 `multiSel`（第 1 个），Composer 保持打开继续累加；多→单提升最后一个选中元素为锁定；切换不丢已输入 prompt。文案英文（`Single`/`Multi`）。
- **发送后立即清理**：`sendPrompt` 先快照 `els`，立即 `clearMulti()/clearSingle()`，**不用 setTimeout 延迟清理**（避免清掉新一轮选择）。
- **滚动**：`scroll` 时重算徽标/操作条；元素滚出视口则清除该选中。
- **Composer 关闭语义**：单选下 ✕/Esc 只关 Composer 回到选取（保留已选）；**多选下 ✕/Esc = 清空选择并关闭**（避免关掉后无法重新打开的死路）；Esc 在无 Composer 打开时退出整个选择模式（`picker-cancelled`）。
- **rAF 节流** hover 高亮与 tooltip 定位，避免 mousemove 每像素重排。
- **jsdom 注意**：`width:min(...)`/`backdrop-filter` 会让 cssText 解析失败 → `style.display` 为空串。所有「Composer 是否打开」判断用**正向谓词** `composer.style.display === 'flex'`（而非 `!== 'none'`）。
- **注入类隔离**：`neeko-selected`/`neeko-hover` 只用于高亮，**禁止泄漏**进对外数据 —— `getSelector()` 过滤这两类；`copySelected`/`sendPrompt` 经 `cleanOuterHTML()`（临时摘类→抓 outerHTML→还原）输出干净 HTML（曾泄漏 `div.x.neeko-selected` 至 chip 与剪贴板）。
- **单选 refine（Parent/Child）**：切换锁定元素时**保持 Composer 打开并同步 chip**（不丢已输入内容）—— `applySelection(el)` 只换高亮/角标/操作条/chip，不清空不关闭；`lockSelection`（点击锁定路径）才 `clearSelected + applySelection`（曾误走 `lockSelection` 导致 Composer 被 `clearSelected→closeComposer` 关掉，已修复 + 回归测试）。
- **macOS 菜单 Edit 命令转发（复制/粘贴/全选）**：macOS 下 Cmd+C/V/A/X 被应用菜单 Edit 加速键在 OS 层截获，原始 keydown **到不了任何 webview**；`app_menu::handle_menu_event` 是唯一入口，且只转发到 `main` webview —— 选择器输入框在 `neeko-browser-*` **子 webview**，故收不到。修复：输入框 `focusin/focusout` 经 `neeko://` POST `picker-focused/picker-blurred` → Rust `PICKER_INPUT_FOCUSED` 静态位 → 菜单 handler 聚焦时改转发到浏览器子 webview（`app.webviews()` 按 `neeko-browser-` 前缀找，`webview.eval(execCommand)`；粘贴用 `execCommand('paste')`，WKWebView 可能弹原生粘贴确认）。Windows/Linux 无 Edit 菜单、不拦截，原生快捷键正常。

## 7. 主题与样式

- 复用 `__NEEKO_THEME__`（`bgSecondary/bgTertiary/textPrimary/textMuted/borderColor/accentBlue`）。
- 高亮 = `outline: 2px dashed accent; outline-offset: 2px; box-shadow: 0 0 0 4px rgba(accent,.16), 0 0 18px rgba(accent,.28)`。
- 选中 = 实线 outline + 更强阴影。
- 注入脚本内联样式用 `all:initial` 基线 + 显式颜色（避免页面样式污染），与原型 CSS 语义一一对应。

## 8. 兼容性与边界

- **向后兼容**：`prompt-submitted` 为 Breaking Change —— Rust 与前端**同 commit 原子升级**，避免旧 payload 进入新解析器被拒。
- **shadow DOM**：原型/一期仅处理文档树；shadow host 本身可选，shadow root 内部元素一期不穿透（记入已知限制）。
- **iframe**：一期不进入跨源 iframe 选取（记入已知限制）。
- **不可选取**：`documentElement`/`body`/覆盖层忽略。
- **大 HTML**：沿用 POST body 主通道（不受 URL 长度限制）；多选总 HTML 超 2MB 时前端虚拟化/截断策略另议（当前限制 8 个元素内）。

## 9. 测试计划

| 层 | 用例 |
| --- | --- |
| Rust `uri_scheme` | 数组消息解析 ✓、缺 `elements` / 空数组 / 元素缺 `html` → None、去重窗口、`element-picked`/`picker-cancelled` 不变 |
| 前端 `pickerUtils` | `formatPickerMessage` 多元素输出（编号 + selector + 双代码块）；`getSelector` 边界；`isAgentCliTab` 不变 |
| 前端组件/行为 | 多选累加/取消/chips 渲染 + 药丸切模式携带/提升（jsdom 注入测试 `pickerScript.test.ts`） |
| 手动 UX | 单选锁定/父子级/多选 chips/发送竞态回归（参照原型验证清单） |

## 10. 参考文件

- `src-tauri/src/browser/picker_script.js`（主改）
- `src-tauri/src/browser/uri_scheme.rs`（协议 + 单测）
- `src-tauri/src/browser/events.rs`（事件名不变）
- `src/features/browser/hooks/useBrowserPanel.ts`（payload + 守卫）
- `src/features/browser/components/pickerUtils.ts`（`formatPickerMessage` + 测试）
- 原型：`./browser-picker-prototype.html`
