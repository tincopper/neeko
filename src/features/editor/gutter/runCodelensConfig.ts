/**
 * Run/Debug codelens 的**编辑器配置 Facet**（CodeMirror 状态原语，属 editor 渲染层）。
 *
 * 与 `runner/runTarget` 分离：那边是**运行目标身份**（纯数据，runner 域持有）；
 * 这里是**把配置注入编辑器状态**的 Facet 容器（`fileName` + 点击回调），变更原因随
 * 「编辑器装配」而非「跑测语义」——拆出避免 runner 纯逻辑域引入 `@codemirror/state`。
 */
import { Facet } from '@codemirror/state';

import type { RunTarget } from '@/features/runner';

/** Per-editor configuration injected via facet (fileName + click callbacks). */
export interface RunCodelensConfig {
  fileName: string;
  /** LSP runnable 拉取所需的项目上下文（缺省则跳过 tier ①，只走快路径）。 */
  projectId?: string;
  /** 被编辑文件绝对路径（`file://` uri 构造）。 */
  absFilePath?: string;
  /** LSP 会话键（项目根 / worktree 根）。 */
  projectPath?: string | null;
  onRun: (target: RunTarget) => void;
  /** Rust/Go/Java（测试与 main 皆然）点击 → 请求 React 层在图标 rect 旁（x/y 为 rect
   *  推导锚点）打开 Run/Debug 浮层。 */
  onMenuRequest: (target: RunTarget, x: number, y: number) => void;
}

export const runCodelensConfig = Facet.define<RunCodelensConfig, RunCodelensConfig>({
  combine: (configs) => configs[0],
});
