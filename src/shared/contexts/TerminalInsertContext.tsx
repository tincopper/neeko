import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

/**
 * 终端/Agent 输入插入能力的显式通道（替代 window 全局函数桥接）。
 *
 * 背景：Library 面板（dock 区域）需要把 prompt 插入到 ProjectWorkspace 持有的
 * 活动终端 / agent 输入。此前通过 `window.__neekoInsertTo*` 全局函数隐式耦合
 * （无类型契约、生命周期依赖外部挂载、竞态窗口）。改为 Context：
 * - ProjectWorkspace（能力提供方）挂载时 register，卸载时 unregister；
 * - LibraryPanel 等消费方通过 useTerminalInsert() 读取当前可用能力；
 * - 无能力提供方时 api 为空对象，消费方自行降级（如 clipboard 兜底）。
 */
export interface TerminalInsertApi {
  /** 写入活动终端 PTY；成功返回 true；无活动终端/失败返回 false。 */
  insertToTerminal?: (text: string) => boolean;
  /** 插入到 agent 输入（best-effort 事件桥接，无返回值）。 */
  insertToAgentInput?: (text: string) => void;
}

interface TerminalInsertContextValue {
  /** 当前注册的插入能力（可能为空对象）。 */
  api: TerminalInsertApi;
  /** 注册（或替换）能力；返回注销函数（卸载时调用）。 */
  register: (api: TerminalInsertApi) => () => void;
}

const TerminalInsertContext = createContext<TerminalInsertContextValue | null>(null);

export function TerminalInsertProvider({ children }: { children?: ReactNode }) {
  const [api, setApi] = useState<TerminalInsertApi>({});

  const register = useCallback((next: TerminalInsertApi) => {
    setApi(next);
    return () => setApi({});
  }, []);

  const value = useMemo(() => ({ api, register }), [api, register]);

  return <TerminalInsertContext.Provider value={value}>{children}</TerminalInsertContext.Provider>;
}

export function useTerminalInsert(): TerminalInsertContextValue {
  const ctx = useContext(TerminalInsertContext);
  if (!ctx) {
    throw new Error('useTerminalInsert must be used within TerminalInsertProvider');
  }
  return ctx;
}
