import { useEffect } from 'react';

type Callback = (projectId: string) => void;

const subscribers = new Set<Callback>();

/**
 * 通知所有订阅者：某项目的 Git 状态已刷新（点击 Git 面板刷新按钮时调用）。
 * 用于驱动 diff 等依赖 Git 状态的缓存失效。
 */
export function bumpGitRefresh(projectId: string) {
  for (const cb of subscribers) cb(projectId);
}

/**
 * 订阅 Git 刷新信号：当 Git 面板刷新按钮触发时调用回调。
 * 模块级订阅，无 IPC 开销。
 */
export function useGitRefresh(callback: Callback) {
  useEffect(() => {
    subscribers.add(callback);
    return () => {
      subscribers.delete(callback);
    };
  }, [callback]);
}
