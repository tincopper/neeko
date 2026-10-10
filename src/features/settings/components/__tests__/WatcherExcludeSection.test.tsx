import { render, screen, fireEvent } from '@testing-library/react';
import { useState } from 'react';
import { describe, it, expect, vi } from 'vitest';

import WatcherExcludeSection from '@/features/settings/components/WatcherExcludeSection';

/** 受控宿主：模拟生产环境（父级同步接收并回传子组件发出的模式）。 */
function Controlled({ initial }: { initial: string[] }) {
  const [excludes, setExcludes] = useState(initial);
  return <WatcherExcludeSection excludes={excludes} onExcludesChange={setExcludes} />;
}

describe('WatcherExcludeSection', () => {
  it('每行渲染一个模式', () => {
    render(
      <WatcherExcludeSection excludes={['target/', '**/dist/**']} onExcludesChange={vi.fn()} />,
    );
    expect(screen.getByLabelText('Watcher exclude patterns')).toHaveValue('target/\n**/dist/**');
  });

  it('编辑时按行解析（去空行/空白）并回调', () => {
    const onChange = vi.fn();
    render(<WatcherExcludeSection excludes={[]} onExcludesChange={onChange} />);
    fireEvent.change(screen.getByLabelText('Watcher exclude patterns'), {
      target: { value: ' target/ \n\n**/dist/**\n' },
    });
    expect(onChange).toHaveBeenCalledWith(['target/', '**/dist/**']);
  });

  it('外部值变化时回灌编辑区', () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <WatcherExcludeSection excludes={['a/']} onExcludesChange={onChange} />,
    );
    rerender(<WatcherExcludeSection excludes={['b/']} onExcludesChange={onChange} />);
    expect(screen.getByLabelText('Watcher exclude patterns')).toHaveValue('b/');
  });

  it('受控父级回传自己刚发出的模式（等价回声）不重置本地尾部换行', () => {
    render(<Controlled initial={[]} />);
    const textarea = screen.getByLabelText('Watcher exclude patterns');
    fireEvent.change(textarea, { target: { value: 'target/\n' } });
    expect(textarea).toHaveValue('target/\n');
  });
});
