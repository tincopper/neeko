import * as ResizablePrimitive from 'react-resizable-panels';

import { cn } from '@/lib/utils';

const ResizablePanelGroup = ({
  className,
  ...props
}: React.ComponentProps<typeof ResizablePrimitive.Group>) => (
  <ResizablePrimitive.Group className={cn('flex h-full w-full', className)} {...props} />
);

const ResizablePanel = ({
  className,
  ...props
}: React.ComponentProps<typeof ResizablePrimitive.Panel>) => (
  <ResizablePrimitive.Panel className={cn('flex flex-col overflow-hidden', className)} {...props} />
);

/**
 * 拖拽手柄。
 *
 * `orientation` **必须与所属 Group 一致**：手柄自己的几何（细边在哪一轴）与光标形状都取决于
 * 它。写死横向（`w-px` + `cursor-col-resize`）放进竖向 Group 的症状是「手柄变成一根 1px 宽的
 * 竖线、拖拽命中区几乎为零、光标还是左右箭头」—— 布局看着对，就是拖不动。
 *
 * 默认横向：既有调用点（DockLayout / LibraryPanel / EditorGroupLayout）全是横向 Group。
 */
const ResizableHandle = ({
  withHandle,
  orientation = 'horizontal',
  className,
  ...props
}: React.ComponentProps<typeof ResizablePrimitive.Separator> & {
  withHandle?: boolean;
  orientation?: 'horizontal' | 'vertical';
}) => {
  const horizontal = orientation === 'horizontal';
  return (
    <ResizablePrimitive.Separator
      className={cn(
        'relative flex items-center justify-center bg-transparent transition-colors hover:bg-bg-hover active:bg-bg-hover',
        horizontal ? 'w-px cursor-col-resize' : 'h-px w-full cursor-row-resize',
        className,
      )}
      {...props}
    >
      {withHandle && (
        <div
          className={cn(
            'z-10 rounded-none bg-transparent hover:bg-bg-hover',
            horizontal
              ? 'flex h-8 w-px items-center justify-center'
              : 'flex h-px w-8 items-center justify-center',
          )}
        >
          {/* No grip icon — keep it invisible like original resize handles */}
        </div>
      )}
    </ResizablePrimitive.Separator>
  );
};

export { ResizablePanelGroup, ResizablePanel, ResizableHandle };
