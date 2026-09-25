import type { FileChange } from '@/shared/types';

/**
 * Discard 语义域（纯函数 + 类型，无 React、无 IPC）。
 *
 * ## 第一性原理：一次 discard = 「一组路径」+「这组路径从哪来」
 *
 * 「丢弃单个文件」「丢弃选中」「丢弃整组」在 UI 上是三个入口，在语义上是同一件事：
 * 让一批路径回到无变更状态。差别只在于**路径集合从哪来**，所以：
 * - 执行侧只认 `paths`（一个后端 `discard_files(paths)` 承载全部三种入口）；
 * - `scope` / `changeClass` 只是**呈现元数据**，用来生成确认文案 —— 不参与执行。
 *
 * 由此得到一条硬约束（本模块存在的理由）：
 * **确认文案里描述的那批文件，必须与实际执行的那批文件逐字相同**。
 * 若确认时说「3 个文件」而执行时让后端重新枚举仓库状态，二次确认就成了谎言。
 * 所以 `paths` 在确认前就定死，后端不再自行扩大范围。
 *
 * ## 为什么 changeClass 是一等概念
 *
 * tracked 与 unversioned 的物理语义不同：前者可从 HEAD 复原，后者在 git 里
 * 根本不存在副本、删除即永久丢失。二者不可逆性不同，因此不能合并成
 * 一个「Discard all」—— 分组各有各的入口、各有各的风险文案。
 */

/** 变更类别：已纳入版本控制 / 未跟踪。 */
export type ChangeClass = 'tracked' | 'unversioned';

/** 路径集合的来源（仅影响文案，不影响执行）。 */
export type DiscardScope = 'file' | 'selection' | 'group';

export interface DiscardIntent {
  /** 实际执行的路径集合（非空）。确认文案与执行共用这一份数据。 */
  readonly paths: string[];
  readonly scope: DiscardScope;
  readonly changeClass: ChangeClass;
}

/**
 * 组内「选中优先」解析：有选中 → 只丢弃选中；无选中 → 丢弃整组。
 *
 * 选中是**组内**判定而非全局判定：按钮挂在某个分组头部，其作用域天然是该组，
 * 「对应选项」即该组内的选中项。跨组选中不影响本组判定。
 */
export function resolveDiscardPaths(
  groupFiles: readonly FileChange[],
  selectedFiles: ReadonlySet<string>,
): string[] {
  const selected = groupFiles
    .filter((file) => selectedFiles.has(file.path))
    .map((file) => file.path);
  return selected.length > 0 ? selected : groupFiles.map((file) => file.path);
}

/**
 * 构造分组头部的 discard 意图。
 *
 * `scope` 由结果反推而非入口写死：选中数等于组大小时即为「整组」，
 * 文案随之从「N 个选中」变为「全部 N 个」—— 语义与真实执行范围始终一致。
 */
export function buildGroupDiscardIntent(
  groupFiles: readonly FileChange[],
  selectedFiles: ReadonlySet<string>,
  changeClass: ChangeClass,
): DiscardIntent | null {
  if (groupFiles.length === 0) return null;
  const paths = resolveDiscardPaths(groupFiles, selectedFiles);
  return {
    paths,
    scope: paths.length === groupFiles.length ? 'group' : 'selection',
    changeClass,
  };
}

/** 构造单行 discard 意图（行内按钮）。 */
export function buildFileDiscardIntent(path: string, changeClass: ChangeClass): DiscardIntent {
  return { paths: [path], scope: 'file', changeClass };
}

/**
 * 丢弃目标的自然语言短语（按钮 tooltip 与确认弹窗共用）。
 *
 * 单一出处：tooltip 与弹窗文案若各写一份，必然漂移（按钮说「2 个选中」、
 * 弹窗说「全部 3 个」）—— 那正是「二次确认」最容易失效的地方。
 */
export function discardTargetPhrase(intent: DiscardIntent): string {
  const count = intent.paths.length;
  const noun = intent.changeClass === 'unversioned' ? 'unversioned file' : 'change';
  const nounPhrase = count === 1 ? noun : `${noun}s`;

  switch (intent.scope) {
    case 'file':
      return `'${intent.paths[0] ?? ''}'`;
    case 'selection':
      return `${count} selected ${nounPhrase}`;
    case 'group':
      return `all ${count} ${nounPhrase}`;
  }
}

export interface DiscardPrompt {
  title: string;
  description: string;
  confirmLabel: string;
}

/** 确认弹窗文案（纯派生：意图 → 文案）。新增 scope/class 只需在此补一行。 */
export function describeDiscard(intent: DiscardIntent): DiscardPrompt {
  const isUnversioned = intent.changeClass === 'unversioned';

  let title: string;
  switch (intent.scope) {
    case 'group':
      title = isUnversioned ? 'Discard all unversioned files?' : 'Discard all changes?';
      break;
    case 'selection':
      title = 'Discard selected changes?';
      break;
    case 'file':
      title = 'Discard changes?';
      break;
  }

  // 风险文案必须随类别变化：unversioned 无副本可恢复，是真正的不可逆操作。
  const consequence = isUnversioned
    ? 'Unversioned files are not stored in git and will be permanently deleted.'
    : 'Tracked changes will be restored to the last committed state.';

  return {
    title,
    description: `This will discard ${discardTargetPhrase(intent)}. ${consequence} This action cannot be undone.`,
    confirmLabel: intent.scope === 'group' ? 'Discard All' : 'Discard',
  };
}
