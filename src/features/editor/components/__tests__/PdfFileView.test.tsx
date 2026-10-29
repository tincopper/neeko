import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import PdfFileView from '@/features/editor/components/PdfFileView';
import { useProjectStore } from '@/shared/store/projectStore';
import { WorkspaceSession } from '@/shared/utils/workspaceRef';

const readFileSize = vi.fn();
const readFileRange = vi.fn();
const getDocument = vi.fn();
const requestDataRangeSpy = vi.fn();

vi.mock('@/shared/api/fileBytes', () => ({
  readFileSize: (...a: unknown[]) => readFileSize(...a),
  readFileRange: (...a: unknown[]) => readFileRange(...a),
}));

// pdf.js 用替身：测试只验「怎么驱动 pdf.js」，不解码真 PDF。
// 消费点是 **legacy 构建**（modern 构建不带 `Map.prototype.getOrInsertComputed` 之类
// 新内建的 polyfill，WKWebView/WebKitGTK 上会运行期 TypeError）。
vi.mock('pdfjs-dist/legacy/build/pdf.mjs', () => {
  class FakeRangeTransport {
    constructor(
      public length: number,
      public initialData: Uint8Array | null,
    ) {}
    onDataRange = vi.fn();
    requestDataRange = (begin: number, end: number) => requestDataRangeSpy(begin, end);
  }
  return {
    getDocument: (...a: unknown[]) => getDocument(...a),
    PDFDataRangeTransport: FakeRangeTransport,
    GlobalWorkerOptions: { workerSrc: '' },
  };
});

vi.mock('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url', () => ({ default: 'stub-worker.js' }));

function makeDoc(numPages: number) {
  return {
    numPages,
    getPage: vi.fn(async () => ({
      getViewport: ({ scale }: { scale: number }) => ({
        width: 612 * scale,
        height: 792 * scale,
      }),
      render: () => ({ promise: Promise.resolve(), cancel: vi.fn() }),
    })),
    destroy: vi.fn(async () => {}),
  };
}

const projectId = WorkspaceSession.of('p1', null).projectId;

function setup(overrides: { numPages?: number; size?: number } = {}) {
  readFileSize.mockResolvedValue(overrides.size ?? 2048);
  readFileRange.mockImplementation((_w: unknown, _p: string, r: { begin: number; end: number }) =>
    Promise.resolve(new Uint8Array(r.end - r.begin)),
  );
  getDocument.mockReturnValue({ promise: Promise.resolve(makeDoc(overrides.numPages ?? 50)) });
  useProjectStore.setState({
    projects: [{ id: 'p1', environment: { type: 'Local' } }] as never,
    activeProjectId: 'p1',
  } as never);
}

function pageNumbersOnScreen(): number[] {
  return screen
    .queryAllByTestId('pdf-page-canvas')
    .map((el) => Number(el.getAttribute('data-page')));
}

beforeEach(() => {
  vi.clearAllMocks();
  // jsdom 无 2d 上下文：给一个最小替身，让渲染路径走通。
  HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
    scale: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    fillRect: vi.fn(),
    fillStyle: '',
  })) as never;
});

describe('PdfFileView', () => {
  it('先探文件大小，再以 range transport 打开文档', async () => {
    setup({ size: 4096 });
    render(<PdfFileView filePath="docs/a.pdf" fileName="a.pdf" projectId={projectId} />);

    expect(screen.getByText('Loading PDF…')).toBeInTheDocument();
    expect(await screen.findByText(/\/ 50/)).toBeInTheDocument();

    expect(readFileSize).toHaveBeenCalledWith(expect.anything(), 'docs/a.pdf');
    const options = getDocument.mock.calls[0][0] as Record<string, unknown>;
    // 按需拉取：不自动抓整份文件
    expect(options.disableAutoFetch).toBe(true);
    expect(options.rangeChunkSize).toBe(1024 * 1024);
    expect((options.range as { length: number }).length).toBe(4096);
    // CJK / 未嵌入字体 / JPX 图像所需的运行时资源（缺了会缺字或解码失败）
    expect(options.cMapUrl).toBe('/pdfjs/cmaps/');
    expect(options.cMapPacked).toBe(true);
    expect(options.standardFontDataUrl).toBe('/pdfjs/standard_fonts/');
    expect(options.wasmUrl).toBe('/pdfjs/wasm/');
  });

  it('Fit width 按内容盒宽度计算（扣掉两侧内边，不溢出补偿量）', async () => {
    setup({ numPages: 3 });
    // 滚动区 clientWidth 800、左侧补偿 11（= 滚动条占位） ⇒ 内容盒 789，
    // 再扣 fitWidthScale 的 padding 32 ⇒ 757 / 612 ≈ 1.237 ⇒ 展示 124%
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
      configurable: true,
      get: () => 800,
    });
    vi.spyOn(window, 'getComputedStyle').mockImplementation(
      () =>
        ({
          paddingLeft: '11px',
          paddingRight: '0px',
          getPropertyValue: (prop: string) =>
            prop === 'padding-left' ? '11px' : prop === 'padding-right' ? '0px' : '',
        }) as unknown as CSSStyleDeclaration,
    );

    render(<PdfFileView filePath="a.pdf" fileName="a.pdf" projectId={projectId} />);
    expect(await screen.findByTestId('pdf-viewer')).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('Fit width'));
    expect(await screen.findByText('124%')).toBeInTheDocument();

    vi.restoreAllMocks();
  });

  it('连续滚动只渲染可视窗口内的页（虚拟化，AC6）', async () => {
    setup({ numPages: 50 });
    render(<PdfFileView filePath="a.pdf" fileName="a.pdf" projectId={projectId} />);
    expect(await screen.findByTestId('pdf-viewer')).toBeInTheDocument();

    const shown = pageNumbersOnScreen();
    expect(shown.length).toBeGreaterThan(0);
    expect(shown.length).toBeLessThan(10); // 50 页的文档绝不整本渲染
  });

  it('range 请求经字节通道读满 [begin, end)（短读由通道续读，不在此处截断）', async () => {
    setup({ size: 4096 });
    render(<PdfFileView filePath="a.pdf" fileName="a.pdf" projectId={projectId} />);
    expect(await screen.findByTestId('pdf-viewer')).toBeInTheDocument();

    // pdf.js 侧调用 requestDataRange → 组件应翻译成 readFileBytes(offset, length)
    requestDataRangeSpy(0, 1024);
    const transportOptions = getDocument.mock.calls[0][0] as {
      range: { requestDataRange(b: number, e: number): void };
    };
    transportOptions.range.requestDataRange(100, 300);

    await waitFor(() =>
      expect(readFileRange).toHaveBeenCalledWith(expect.anything(), 'a.pdf', {
        begin: 100,
        end: 300,
      }),
    );
  });

  it('单页模式只渲染当前页，并可翻页 / 键盘翻页', async () => {
    setup({ numPages: 20 });
    render(<PdfFileView filePath="a.pdf" fileName="a.pdf" projectId={projectId} />);
    expect(await screen.findByTestId('pdf-viewer')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Single'));
    expect(pageNumbersOnScreen()).toEqual([1]);

    fireEvent.click(screen.getByLabelText('Next page'));
    await waitFor(() => expect(pageNumbersOnScreen()).toEqual([2]));

    fireEvent.keyDown(screen.getByRole('region'), { key: 'ArrowRight' });
    await waitFor(() => expect(pageNumbersOnScreen()).toEqual([3]));

    fireEvent.keyDown(screen.getByRole('region'), { key: 'ArrowLeft' });
    await waitFor(() => expect(pageNumbersOnScreen()).toEqual([2]));
  });

  it('缩放改变页面宽度与百分比显示', async () => {
    setup({ numPages: 5 });
    render(<PdfFileView filePath="a.pdf" fileName="a.pdf" projectId={projectId} />);
    expect(await screen.findByTestId('pdf-viewer')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Single'));
    const before = pageNumbersOnScreen()[0];
    expect(before).toBe(1);
    const widthBefore = Number(screen.getByTestId('pdf-page-canvas').style.width.replace('px', ''));

    fireEvent.click(screen.getByLabelText('Zoom in'));
    expect(await screen.findByText('125%')).toBeInTheDocument();
    const widthAfter = Number(screen.getByTestId('pdf-page-canvas').style.width.replace('px', ''));
    expect(widthAfter).toBeGreaterThan(widthBefore);
  });

  it('损坏 / 无法读取的 PDF 显示明确错误（不崩溃）', async () => {
    setup();
    readFileSize.mockRejectedValue(new Error('Invalid path: No such file'));
    render(<PdfFileView filePath="a.pdf" fileName="broken.pdf" projectId={projectId} />);

    expect(await screen.findByText(/Cannot open PDF: broken\.pdf/)).toBeInTheDocument();
    expect(screen.getByText(/Invalid path/)).toBeInTheDocument();
  });

  it('getDocument 拒绝（损坏文件结构）同样落错误态', async () => {
    setup();
    getDocument.mockReturnValue({ promise: Promise.reject(new Error('Invalid PDF structure')) });
    render(<PdfFileView filePath="a.pdf" fileName="bad.pdf" projectId={projectId} />);

    expect(await screen.findByText(/Cannot open PDF/)).toBeInTheDocument();
    expect(screen.getByText(/Invalid PDF structure/)).toBeInTheDocument();
  });

  it('空文件直接报错，不进入加载循环', async () => {
    setup({ size: 0 });
    render(<PdfFileView filePath="a.pdf" fileName="empty.pdf" projectId={projectId} />);
    expect(await screen.findByText(/Empty PDF file/)).toBeInTheDocument();
  });

  it('未选中项目时给出明确错误而不是空白', async () => {
    setup();
    useProjectStore.setState({ projects: [] as never, activeProjectId: null } as never);
    render(<PdfFileView filePath="a.pdf" fileName="a.pdf" />);
    expect(await screen.findByText(/No project selected/)).toBeInTheDocument();
  });
});
