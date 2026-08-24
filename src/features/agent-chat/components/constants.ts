import { Circle, Clipboard, Flame, MinusCircle, Settings, Zap } from 'lucide-react';

/** Agent 模式选项（composer 参数选择器）。 */
export const AGENT_MODES = [
  { id: 'build', name: 'Build', desc: 'Execute changes directly', icon: Settings },
  { id: 'plan', name: 'Plan', desc: "Plan only, don't execute", icon: Clipboard },
];

/** 思考强度选项（composer 参数选择器）。 */
export const THINKING_LEVELS = [
  { id: 'low', name: 'Low', desc: 'Fast responses', icon: MinusCircle },
  { id: 'medium', name: 'Medium', desc: 'Balanced thinking', icon: Circle },
  { id: 'high', name: 'High', desc: 'Deep reasoning', icon: Zap },
  { id: 'max', name: 'Max', desc: 'Maximum reasoning effort', icon: Flame },
];

/** agent 名称 → 两字母徽标。 */
export function agentTag(name: string): string {
  return name.slice(0, 2).toUpperCase();
}

/** agent id → 稳定伪随机色相（同一 id 颜色恒定）。 */
export function agentColor(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 360;
  return `hsl(${h} 60% 55%)`;
}
