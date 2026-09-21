import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  __resetDocumentOwnershipForTests,
  claimDocumentOwnership,
  releaseDocumentOwnership,
} from '../documentOwnership';
import * as lspOwnershipApi from '../lspOwnershipApi';

vi.mock('../lspOwnershipApi', () => ({
  lspClaimDocument: vi.fn(() => Promise.resolve()),
  lspReleaseDocument: vi.fn(() => Promise.resolve()),
}));

describe('documentOwnership — 编辑器文档所有权的引用计数', () => {
  beforeEach(() => {
    __resetDocumentOwnershipForTests();
    vi.clearAllMocks();
  });

  it('单视图：挂载声明一次、卸载释放一次', () => {
    claimDocumentOwnership('/p', 'rust', 'file:///a.rs');
    expect(lspOwnershipApi.lspClaimDocument).toHaveBeenCalledTimes(1);

    releaseDocumentOwnership('/p', 'rust', 'file:///a.rs');
    expect(lspOwnershipApi.lspReleaseDocument).toHaveBeenCalledTimes(1);
  });

  /// 分屏 / 重挂：两个视图共用一个文件时，只有最后一个消失才释放
  /// —— 否则中间那次 release 会把所有权抖掉，后端又开始拿磁盘文本代开。
  it('多视图：0→1 才声明、1→0 才释放', () => {
    claimDocumentOwnership('/p', 'rust', 'file:///a.rs');
    claimDocumentOwnership('/p', 'rust', 'file:///a.rs');
    expect(lspOwnershipApi.lspClaimDocument).toHaveBeenCalledTimes(1);

    releaseDocumentOwnership('/p', 'rust', 'file:///a.rs');
    expect(lspOwnershipApi.lspReleaseDocument).not.toHaveBeenCalled();

    releaseDocumentOwnership('/p', 'rust', 'file:///a.rs');
    expect(lspOwnershipApi.lspReleaseDocument).toHaveBeenCalledTimes(1);
  });

  it('不同（project, language, uri）各自独立计数', () => {
    claimDocumentOwnership('/p', 'rust', 'file:///a.rs');
    claimDocumentOwnership('/p', 'go', 'file:///a.rs');
    claimDocumentOwnership('/q', 'rust', 'file:///a.rs');
    expect(lspOwnershipApi.lspClaimDocument).toHaveBeenCalledTimes(3);

    releaseDocumentOwnership('/p', 'rust', 'file:///a.rs');
    expect(lspOwnershipApi.lspReleaseDocument).toHaveBeenCalledTimes(1);
  });

  /// 无配对的 release（如卸载顺序异常）也必须释放，不能把所有权永久留在后端。
  it('未声明过就释放：仍然发 release（不留悬挂所有权）', () => {
    releaseDocumentOwnership('/p', 'rust', 'file:///a.rs');
    expect(lspOwnershipApi.lspReleaseDocument).toHaveBeenCalledTimes(1);
  });
});
