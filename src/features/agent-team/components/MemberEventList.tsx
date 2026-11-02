import React from 'react';

import type { MemberEventView } from '@/shared/types/team';

import {
  MAX_MEMBER_EVENTS,
  memberEventKindText,
  memberEventSummary,
  memberEventTime,
} from '../utils/memberEvents';

/**
 * 抽屉里的「最近事件」：时间 + 类别 + 摘要。
 *
 * # `detail` 只画一行，全文进 `title`
 *
 * 后端写的是短文本，但它可能带换行（多行上下文），而行内换行会把列表的高度撑成不可预测的
 * 样子。所以：**一行 + 截断**用于视觉，完整原文进 `title`（悬停可读）。
 * 反过来是错的 —— 只画截断后的文本、又不给全文，等于把信息砍掉而不是收起来。
 *
 * # 截断提示
 *
 * `eventsTruncated` 为真时必须说出来（「只显示最近 50 条」）：不说的话，用户会以为这个成员
 * 一共只发生过 50 件事。数字来自 [`MAX_MEMBER_EVENTS`]（镜像后端常量）。
 */
interface MemberEventListProps {
  events: readonly MemberEventView[];
  /** 后端是否还有更早的事件没给（`view::member_events` 多读一行判出来的）。 */
  truncated: boolean;
}

const MemberEventList: React.FC<MemberEventListProps> = React.memo(({ events, truncated }) => (
  <section aria-label="成员最近事件" className="flex flex-col gap-1">
    <header className="flex items-baseline justify-between">
      <h4 className="text-meta font-semibold text-text-secondary">最近事件</h4>
      <span className="text-micro text-text-muted">{events.length} 条</span>
    </header>
    {events.length === 0 ? (
      <p className="text-micro text-text-muted">还没有事件</p>
    ) : (
      <ul className="flex flex-col gap-0.5">
        {events.map((event, index) => {
          const summary = memberEventSummary(event);
          return (
            // 同一个成员的两条事件时间戳可能完全相同（一次动作写多条），所以键带上下标 ——
            // 用 `at` 做键会让 React 在重取后错位复用行。
            <li
              key={`${event.at}-${event.kind}-${index}`}
              data-event-kind={event.kind}
              className="flex items-start gap-1.5 text-micro"
            >
              <span className="shrink-0 font-mono text-text-muted">
                {memberEventTime(event.at)}
              </span>
              <span className="shrink-0 text-text-secondary">
                {memberEventKindText(event.kind)}
              </span>
              {summary === null ? null : (
                <span
                  title={summary.full}
                  className="min-w-0 flex-1 truncate text-text-muted"
                  // 摘要只是上下文，不是判据：读屏用户拿到的是完整原文。
                  aria-label={summary.full}
                >
                  {summary.line}
                </span>
              )}
            </li>
          );
        })}
      </ul>
    )}
    {truncated ? (
      <p className="text-micro text-text-muted">
        只显示最近 {MAX_MEMBER_EVENTS} 条事件（更早的去库里查）
      </p>
    ) : null}
  </section>
));
MemberEventList.displayName = 'MemberEventList';

export default MemberEventList;
