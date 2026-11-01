import React from 'react';

import { cn } from '@/lib/utils';

import { useCliHookHealth } from '../hooks/useCliHookHealth';

/**
 * 侧栏底部的 **CLI hook 提示**：hook 没在生效时告诉用户「会话标题不会跟随 CLI」，并给一个
 * 重新安装入口。
 *
 * # 为什么不放进设置页就够
 *
 * 设置页是「我去改配置」的地方，而这个问题的表现是「侧栏标题不对」—— 用户不会想到去设置页
 * 找原因。提示出现在**后果发生的地方**（侧栏），才可能被看见。
 *
 * # 只在真的不生效时出现
 *
 * 健康（全部已安装 / 已过期但已重装 / 用户主动关掉）时渲染 `null`：
 * 侧栏是主界面，常驻一条「一切正常」的横幅只是噪声。
 */
const CliHookHint: React.FC<{ className?: string }> = ({ className }) => {
  const { attentionSources, installing, reinstall, error } = useCliHookHealth();
  if (attentionSources.length === 0 && !error) return null;

  const sources = attentionSources.join(', ');
  return (
    <div
      className={cn(
        'mx-2 mb-2 flex items-center gap-2 rounded-md border border-border-subtle bg-bg-surface px-2 py-1.5',
        className,
      )}
      data-testid="cli-hook-hint"
    >
      <span className="min-w-0 flex-1 text-[0.82em] text-text-muted">
        {error ? `Hook 安装失败：${error}` : `会话标题未跟随 CLI（hook 未生效：${sources}）`}
      </span>
      <button
        type="button"
        disabled={installing}
        onClick={() => void reinstall()}
        className="shrink-0 cursor-pointer rounded px-1.5 py-0.5 text-[0.82em] text-accent-blue transition-colors hover:bg-bg-hover disabled:cursor-progress disabled:text-text-muted"
      >
        {installing ? '安装中…' : '重新安装'}
      </button>
    </div>
  );
};

export default React.memo(CliHookHint);
