import type { ConfirmRequest } from '@/shared/store/confirmStore';
import type { Tab } from '@/shared/types';
import type { ConversationDeleteSupport } from '@/shared/types/session';

import type { ConversationMeta } from '../types';

import { isConversationLiveInChat } from './conversationInUse';

/**
 * 删除入口显隐的**唯一判据**。
 *
 * `unsupported` 与「字段缺失」（旧载荷 / 旧磁盘索引）都不显示 —— 宁缺不错：
 * 默认显示会让未实测的 agent 拿到一个删不干净的按钮。
 */
export function canDeleteConversation(meta: {
  deleteSupport?: ConversationDeleteSupport;
}): boolean {
  return meta.deleteSupport === 'native' || meta.deleteSupport === 'storage';
}

/** 删除一条历史会话所需的全部外部依赖（注入 → 编排可脱离 React / IPC 单测）。 */
export interface DeleteConversationDeps {
  /** 当前全部已打开的 tab（跨 tab 空间展平，见 `flattenTabSpaces`）。 */
  tabs: readonly Tab[];
  showToast: (message: string, type?: 'info' | 'error') => void;
  /** 确认弹窗（生产传 `confirmAction`，单测注入）。 */
  confirm: (request: ConfirmRequest) => Promise<boolean>;
  /** 真正执行删除（生产传 `conversationApi.deleteConversation`）。 */
  deleteConversation: (id: string) => Promise<void>;
  /** Agent 显示名（容器层按 agentId 反查；缺失时退回 agentId）。 */
  agentName?: string | null;
  /**
   * 关闭占用这条会话的 tab（活 chat / 只读查看器）。**删除成功后**由编排调用：
   * tab 空间键只有容器层知道（`editorStore.tabs` 按空间分键）。
   */
  closeTabs?: () => void;
  /**
   * 把失败原因写到后端日志（生产传 `logFrontendError`）。
   *
   * 为什么需要：前端 catch 住的 rejection 只在屏幕上闪一下 toast，用户回述时信息已丢；
   * 落 `~/.neeko/neeko.log` 后「点了没反应 / 失败」这类报告一次就能定位。
   */
  reportError?: (message: string) => void;
  /**
   * 阶段埋点（生产写后端日志；单测断言顺序）。
   *
   * 为什么删除这种**破坏性动作**必须有阶段埋点：「点了没反应」有三种完全不同的成因
   * —— 没走到这一步 / 确认框没弹 / 弹了但没结算 —— 它们在屏幕上**一模一样**，
   * 而用户回述时只能给出「没反应」。埋点把这三者变成日志里可区分的一行。
   */
  trace?: (step: DeleteTraceStep) => void;
}

/** 删除流程的阶段（写进后端日志的 `source=conversation.delete` 行）。 */
export type DeleteTraceStep =
  | 'requested'
  | 'confirmed'
  | 'confirmed-live-chat'
  | 'cancelled'
  | 'invoking'
  | 'deleted';

/**
 * 确认框文案：agent · 标题 · **将要发生什么**（删的是什么、能否撤销）。
 *
 * `liveInChat` = 这条会话当前还挂在 Agent Chat 里：那时删除会连带关闭那个 tab
 * （否则用户在别处留着一条指向已删会话的 chat）。把这件事写进确认文案 —— 用户不该
 * 在点完之后才发现还有东西被关掉。
 */
export function buildDeleteConfirmRequest(
  meta: ConversationMeta,
  agentName?: string | null,
  options: { liveInChat?: boolean } = {},
): ConfirmRequest {
  const agent = agentName?.trim() || meta.agentId;
  const title = (meta.userTitle?.trim() || meta.title?.trim() || meta.id).replace(/\s+/g, ' ');
  const what =
    meta.deleteSupport === 'native'
      ? `Neeko will ask ${agent} to delete this session with its own CLI, so ${agent}'s index and child sessions stay consistent.`
      : `Neeko will delete this session's own storage:\n${meta.filePath}`;

  const chat = options.liveInChat
    ? `\n\nIt is still open in Agent Chat — that tab will be closed too.`
    : '';

  return {
    title: 'Delete conversation?',
    message: `${agent} · ${title}\n\n${what}${chat}\n\nThis cannot be undone.`,
    confirmLabel: 'Delete',
    danger: true,
  };
}

/**
 * 把 invoke 的 reject 值归一成一句人话。
 *
 * # 为什么必须认识 serde 的外部标签形状（2026-10-30 实测缺陷）
 *
 * `AppError` 是 `#[derive(Serialize)]` 的**枚举**，serde 默认用外部标签序列化：
 * `AppError::InvalidInput("…")` → `{"InvalidInput":"…"}`。旧实现只认「字符串」与
 * `{message}`，于是**每一条后端错误都退化成通用文案** —— toast 说「删除失败」，
 * 却把真实原因（路径被拒 / 文件被占用 / CLI 非零退出）丢掉，P2 的「可归因」在最后一寸失效。
 */
export function describeDeleteError(err: unknown): string {
  if (typeof err === 'string' && err.trim()) return err.trim();
  if (err instanceof Error && err.message.trim()) return err.message.trim();
  if (err && typeof err === 'object') {
    const entries = Object.entries(err as Record<string, unknown>);
    // serde 外部标签：单键 + 字符串值（`{"Agent":"…"}` / `{"InvalidInput":"…"}`）。
    // 排除 `{message}` —— 那是通用错误对象的形状，下面单独处理（不要给它加前缀）。
    if (
      entries.length === 1 &&
      entries[0][0] !== 'message' &&
      typeof entries[0][1] === 'string' &&
      entries[0][1].trim()
    ) {
      return `${entries[0][0]}: ${entries[0][1].trim()}`;
    }
    const message = (err as { message?: unknown }).message;
    if (typeof message === 'string' && message.trim()) return message.trim();
  }
  return 'Failed to delete conversation';
}

/**
 * 删除编排（确认 → 执行 → 关掉占用它的 tab → 结果提示）。
 *
 * 返回 `true` 表示**磁盘上确实删掉了** —— 调用方（持有列表状态的那一层）据此移除行。
 * 失败时返回 `false` 且**不**让调用方动列表：失败后乐观移除就是静默谎报
 * （用户以为删了，磁盘还在）。
 *
 * # 为什么不再「活 chat 会话 → 直接拒绝」（2026-10-30 第二次实测修正）
 *
 * 上一版把「挂在 Agent Chat 里」判成死路：用户必须先自己找到并关掉那个 tab，
 * 再回来重删 —— 而且用户根本看不出是哪个 tab（toast 只说「先关掉」，没说是哪个、
 * 也没给路径）。结果就是「点删除没反应」。
 *
 * 正确形状是**把这条死路变成一步**：确认框里说清「那个 chat tab 会被一起关掉」，
 * 用户确认后先删、再关 tab。关 tab 会释放对应的 agent 会话（进程在 `Drop` 时被回收），
 * 因此顺序无所谓 —— 但**删除失败时不能关 tab**，否则用户什么都没得到却丢了面板。
 */
export async function runConversationDelete(
  meta: ConversationMeta,
  deps: DeleteConversationDeps,
): Promise<boolean> {
  deps.trace?.('requested');

  const liveInChat = isConversationLiveInChat(deps.tabs, meta);
  const confirmed = await deps.confirm(
    buildDeleteConfirmRequest(meta, deps.agentName, { liveInChat }),
  );
  if (!confirmed) {
    deps.trace?.('cancelled');
    return false;
  }
  deps.trace?.(liveInChat ? 'confirmed-live-chat' : 'confirmed');

  deps.trace?.('invoking');
  try {
    await deps.deleteConversation(meta.id);
  } catch (err) {
    const reason = describeDeleteError(err);
    deps.reportError?.(reason);
    deps.showToast(reason, 'error');
    return false;
  }

  // 成功后才关占用的 tab：失败时用户还能继续看那份（仍存在的）会话。
  deps.closeTabs?.();
  deps.trace?.('deleted');
  deps.showToast('Conversation deleted', 'info');
  return true;
}
