import React from 'react';

import { cn } from '@/lib/utils';
import { Button } from '@/ui/Button';

import type { RunMode, RunState, WorkItemRun } from '../types';
import { formatCapturedAt, isStale } from '../utils/runFreshness';

/**
 * 一条执行记录（design §4.6 的一行：mode 徽标 · 状态 chip · 绝对时间 · 摘要 · 跳转）。
 *
 * # 为什么从 `WorkItemRunsSection` 抽出来
 *
 * 三张语义表（状态色 / 状态文案 / mode 文案）此前与区块的取数、动作、空态挤在同一个文件里 ——
 * 那个文件已经越了 300 行红线。抽出来的是**纯呈现**：本组件不取数、不发 IPC、不读 store，
 * 只回答「这一行长什么样」。于是「状态色的唯一来源」也落在唯一读它的地方。
 *
 * # 载荷只有摘要（红线 4）
 *
 * 一行一条，只显示 `snapshot.label`（≤ 120 字符，后端截断）。团队任务 / 成员明细不在这里渲染 ——
 * 那是执行域的视图，hub 只存指针。`unknown` 是合法状态：域侧已不存在时不得画成 `failed`。
 *
 * # 两个时间语义必须同源
 *
 * `formatCapturedAt`（绝对时间）与 `isStale`（陈旧度）都从 `utils/runFreshness.ts` 来，且看的是
 * **同一个** `capturedAt`：「几点采的」与「还算不算新」分开写就会两个口径。
 */

/** 执行状态的语义色。`unknown` 是合法值：执行域里已经查不到了，不能画成 `failed`。 */
const RUN_STATE_CLASS: Record<RunState, string> = {
  queued: 'text-text-muted',
  running: 'text-status-running',
  awaiting: 'text-accent-yellow',
  done: 'text-accent-green',
  failed: 'text-status-failed',
  // 域侧已不存在（团队被删 / 会话没了）：中性色 + 「已不可查」，不伪装成失败。
  unknown: 'text-text-muted',
};

const RUN_STATE_LABEL: Record<RunState, string> = {
  queued: 'Queued',
  running: 'Running',
  awaiting: 'Awaiting approval',
  done: 'Completed',
  failed: 'Failed',
  unknown: 'No longer available',
};

const RUN_MODE_LABEL: Record<RunMode, string> = {
  single: 'single',
  team: 'team',
  flow: 'flow',
};

interface WorkItemRunRowProps {
  run: WorkItemRun;
  /**
   * 这行指向的终端 tab 还在吗。
   *
   * 只有 `ref.kind === 'session'` 时才被读。**不在**这里自己查 store：宿主已经订阅了 tab 空间，
   * 每行各查一遍就是 N 份订阅与 N 份「tab 还在不在」的判据。
   */
  tabOpen: boolean;
  /** 陈旧度的「现在」：由宿主在挂载与手动刷新两个瞬间读一次（design §4.6 不轮询）。 */
  now: number;
  /** 点 [Open]：宿主负责 `activateTab`（tabKey 的铸造点不在本组件）。 */
  onOpen: (tabId: string) => void;
}

const WorkItemRunRow: React.FC<WorkItemRunRowProps> = React.memo(
  ({ run, tabOpen, now, onOpen }) => (
    <li data-run-id={run.id} className="flex flex-col gap-0.5">
      <span className="flex flex-wrap items-center gap-1 text-micro">
        <span className="rounded bg-bg-tertiary px-1 text-text-secondary">
          {RUN_MODE_LABEL[run.mode]}
        </span>
        <span className={cn('font-semibold', RUN_STATE_CLASS[run.snapshot.state])}>
          {RUN_STATE_LABEL[run.snapshot.state]}
        </span>
        <span className="text-text-muted" title={new Date(run.snapshot.capturedAt).toISOString()}>
          {formatCapturedAt(run.snapshot.capturedAt)}
        </span>
        {/* 陈旧标记：只说明「这枚快照可能旧了」，不参与任何完成判定（design §4.6）。 */}
        {isStale(run.snapshot.capturedAt, now) ? (
          <span data-stale="true" className="text-accent-yellow">
            · Stale
          </span>
        ) : null}
      </span>
      <span className="flex items-start gap-1">
        <span className="min-w-0 flex-1 text-micro break-words text-text-secondary">
          {run.snapshot.label}
        </span>
        {/*
          `session` 档才有可跳的目标。`team` / `flow` 的跳转分别随 `run-team` / flow 引擎落地 ——
          今天放按钮就是假按钮（US-RUN-3）。已关闭的 tab 同理：留着按钮但置灰 + 一句 title，
          比「点了没反应」诚实。
        */}
        {run.ref.kind === 'session' ? (
          <Button
            variant="secondary"
            size="sm"
            disabled={!tabOpen}
            title={tabOpen ? 'Switch to that terminal' : 'That session is closed'}
            onClick={() => onOpen(run.ref.id)}
          >
            Open
          </Button>
        ) : null}
      </span>
    </li>
  ),
);
WorkItemRunRow.displayName = 'WorkItemRunRow';

export default WorkItemRunRow;
