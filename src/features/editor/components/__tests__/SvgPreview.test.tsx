import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import SvgPreview from '@/features/editor/components/SvgPreview';

describe('SvgPreview', () => {
  it('渲染 sandbox iframe，srcDoc 包裹 SVG 内容', () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"></svg>';
    render(<SvgPreview tabKey="k" tabId="t" content={svg} fileName="a.svg" />);

    const iframe = screen.getByTitle('Preview: a.svg');
    expect(iframe).toBeInTheDocument();
    expect(iframe.getAttribute('sandbox')).toBeTruthy();
    const srcDoc = iframe.getAttribute('srcdoc') ?? '';
    expect(srcDoc).toContain(svg);
  });

  it('SVG 内容变化时 srcDoc 同步更新（脏编辑实时预览）', () => {
    const svg1 = '<svg id="one"></svg>';
    const { rerender } = render(
      <SvgPreview tabKey="k" tabId="t" content={svg1} fileName="a.svg" />,
    );
    expect((screen.getByTitle('Preview: a.svg') as HTMLIFrameElement).srcdoc).toContain('one');

    const svg2 = '<svg id="two"></svg>';
    rerender(<SvgPreview tabKey="k" tabId="t" content={svg2} fileName="a.svg" />);
    expect((screen.getByTitle('Preview: a.svg') as HTMLIFrameElement).srcdoc).toContain('two');
  });
});
