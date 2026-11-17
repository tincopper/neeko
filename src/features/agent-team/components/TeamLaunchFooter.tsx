import { Users } from 'lucide-react';
import React from 'react';

import { cn } from '@/lib/utils';

/**
 * 创建流的**吸附 footer**：旁路警示、启动失败原文、主按钮与实时摘要。
 *
 * # 为什么是吸附的
 *
 * 「开会话」是创建流唯一的提交动作；长表单滚起来时它必须一直在场 —— 够不够得着
 * 按钮不该取决于用户滚到哪里。旁路警示与失败原文随 footer 一起吸住：
 * 后果提示必须出现在按下去之前，失败原因必须贴着能重试的按钮。
 *
 * # 摘要是一段**派生文本**（由宿主算好传入）
 *
 * 本组件不认识草稿 —— 谁持有草稿谁派生（TeamLaunchPanel），这里只呈现。
 */
interface TeamLaunchFooterProps {
  busy: boolean;
  canStart: boolean;
  /** 启动失败的后端原文（`null` = 没有）。 */
  error: string | null;
  /** 旁路审批已选（警示条随 CTA 吸住：后果必须在按下去之前可见）。 */
  bypassSelected: boolean;
  /** 灰按钮的理由（`null` = 可启动）。 */
  blockedReason: string | null;
  /** 实时配置摘要（宿主从草稿派生；`null` = 草稿未落地，不渲染）。 */
  summary: string | null;
  onStart: () => void;
}

const TeamLaunchFooter: React.FC<TeamLaunchFooterProps> = React.memo(
  ({ busy, canStart, error, bypassSelected, blockedReason, summary, onStart }) => (
    <footer className="sticky bottom-0 flex flex-col gap-1.5 border-t border-border bg-bg-secondary/95 p-3 backdrop-blur-sm">
      {bypassSelected ? (
        <p role="note" className="text-micro text-accent-orange">
          ⚠ Bypass approval is selected: nobody confirms before members write to disk. Only use this
          when you fully trust this team&apos;s members.
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="whitespace-pre-wrap text-meta text-accent-red">
          {error}
        </p>
      ) : null}
      <button
        type="button"
        onClick={onStart}
        disabled={!canStart}
        className={cn(
          'flex w-full items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-meta font-semibold',
          'focus-visible:ring-2 focus-visible:ring-accent-blue focus-visible:outline-none',
          'transition-colors',
          canStart
            ? 'bg-accent-blue text-text-on-accent hover:brightness-110'
            : 'cursor-not-allowed bg-bg-tertiary text-text-muted',
        )}
      >
        <Users size={14} aria-hidden="true" />
        {busy ? 'Creating the team…' : 'Start session as lead'}
      </button>
      {blockedReason ? <p className="text-micro text-text-muted">{blockedReason}</p> : null}
      {summary ? (
        <p className="text-micro text-text-muted" aria-label="Current configuration summary">
          {summary}
        </p>
      ) : null}
    </footer>
  ),
);
TeamLaunchFooter.displayName = 'TeamLaunchFooter';

export default TeamLaunchFooter;
