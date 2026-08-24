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

/** 下拉列表显示名修正：deepseek-harness → deepseek。 */
export function displayName(name: string): string {
  return name === 'deepseek-harness' ? 'deepseek' : name;
}
