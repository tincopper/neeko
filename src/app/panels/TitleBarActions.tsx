import OpenIdeButton from '@/app/components/OpenIdeButton';
import { DebugRunButton } from '@/features/debug';
import { TaskRunButton } from '@/features/task';

/**
 * TitleBar 右侧入口按钮清单（单一事实源）。
 *
 * 新增入口只改这里 —— App.tsx 的 `<TitleBar actions={<TitleBarActions />} />`
 * 对按钮清单零感知。按钮为轻量组件（icon + onClick），保持直接 import
 * 不 lazy：避免按钮首次渲染闪烁。
 */
export default function TitleBarActions() {
  return (
    <>
      <OpenIdeButton />
      <TaskRunButton />
      <DebugRunButton />
    </>
  );
}
