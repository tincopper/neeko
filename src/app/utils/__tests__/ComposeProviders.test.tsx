import { render, screen } from '@testing-library/react';
import { createContext, useContext, type ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import ComposeProviders from '../ComposeProviders';

/** 记录 Provider 渲染顺序（从外到内 = 数组从左到右）。 */
const SeenCtx = createContext<string[]>([]);

function RecordingProvider({ id, children }: { id: string; children?: ReactNode }) {
  const seen = useContext(SeenCtx);
  return <SeenCtx.Provider value={[...seen, id]}>{children}</SeenCtx.Provider>;
}

function ShowSeen() {
  const seen = useContext(SeenCtx);
  return <div data-testid="seen">{seen.join(',')}</div>;
}

describe('ComposeProviders', () => {
  it('元素数组按从外到内顺序包裹 children，全部 Provider 均作用于内容', () => {
    render(
      <ComposeProviders
        providers={[
          <RecordingProvider key="outer" id="a" />,
          <RecordingProvider key="inner" id="b" />,
        ]}
      >
        <ShowSeen />
      </ComposeProviders>,
    );
    // a 外层先求值，b 内层后求值 → 数组顺序即包裹顺序
    expect(screen.getByTestId('seen')).toHaveTextContent('a,b');
  });

  it('空 providers 时直接渲染 children', () => {
    render(
      <ComposeProviders providers={[]}>
        <div>content</div>
      </ComposeProviders>,
    );
    expect(screen.getByText('content')).toBeInTheDocument();
  });

  it('元素自带 props 原样保留，仅 children 被注入', () => {
    render(
      <ComposeProviders providers={[<SeenCtx.Provider key="v" value={['preset']} />]}>
        <ShowSeen />
      </ComposeProviders>,
    );
    expect(screen.getByTestId('seen')).toHaveTextContent('preset');
  });
});
