// @vitest-environment node
// closeConfirmStore 行为断言（自 useCloseConfirmation.test.ts 迁移）：
// open/close、三选回传、并发排队（旧请求 resolve 'cancel'）、overlay 计数、无宿主 fail-closed。
import { beforeEach, describe, expect, it } from 'vitest';

import { useOverlayStore } from '@/shared/store/overlayStore';

import { setCloseConfirmHostMounted, useCloseConfirmStore } from '../closeConfirmStore';

describe('closeConfirmStore', () => {
  beforeEach(() => {
    useOverlayStore.getState().reset();
    useCloseConfirmStore.setState({ pending: null });
    // 对话框由 AppModals 常驻渲染，默认视为已就绪（未就绪路径单独测）。
    setCloseConfirmHostMounted(true);
  });

  /**
   * 与 `confirmStore` 同一条不变式：Promise 只有对话框才会结算。`AppModals` 在
   * `SplashScreen` 期间尚未挂载（`App.tsx:32-34`），此时若无宿主守卫，
   * `await closeTabWithConfirmation(...)` 的调用方会永久挂起。
   */
  it('无宿主时 request 立即以 cancel 结算（绝不悬挂）', async () => {
    setCloseConfirmHostMounted(false);

    await expect(useCloseConfirmStore.getState().request('a.ts')).resolves.toBe('cancel');

    expect(useCloseConfirmStore.getState().pending).toBeNull();
    expect(useOverlayStore.getState().count).toBe(0);
  });

  it('request 打开对话框并记录文件名，用户操作前 Promise 未决', async () => {
    let resolved: string | undefined;
    void useCloseConfirmStore
      .getState()
      .request('a.ts')
      .then((v) => (resolved = v));

    expect(useCloseConfirmStore.getState().pending).toEqual({ fileName: 'a.ts' });
    expect(resolved).toBeUndefined();
  });

  it('resolve(save) 关闭对话框并以 save resolve Promise', async () => {
    const p = useCloseConfirmStore.getState().request('a.ts');
    useCloseConfirmStore.getState().resolve('save');

    await expect(p).resolves.toBe('save');
    expect(useCloseConfirmStore.getState().pending).toBeNull();
  });

  it('resolve(cancel) 关闭对话框并返回 cancel', async () => {
    const p = useCloseConfirmStore.getState().request('a.ts');
    useCloseConfirmStore.getState().resolve('cancel');

    await expect(p).resolves.toBe('cancel');
    expect(useCloseConfirmStore.getState().pending).toBeNull();
  });

  it('resolve(discard) 关闭对话框并返回 discard', async () => {
    const p = useCloseConfirmStore.getState().request('a.ts');
    useCloseConfirmStore.getState().resolve('discard');

    await expect(p).resolves.toBe('discard');
    expect(useCloseConfirmStore.getState().pending).toBeNull();
  });

  it('并发请求：新请求覆盖 pending 文件名，旧 Promise resolve cancel（不关旧 tab）', async () => {
    let firstResolved: string | undefined;
    void useCloseConfirmStore
      .getState()
      .request('a.ts')
      .then((v) => (firstResolved = v));

    const second = useCloseConfirmStore.getState().request('b.ts');

    expect(useCloseConfirmStore.getState().pending).toEqual({ fileName: 'b.ts' });
    await Promise.resolve();
    expect(firstResolved).toBe('cancel');

    useCloseConfirmStore.getState().resolve('discard');
    await expect(second).resolves.toBe('discard');
  });

  it('request 打开 overlay（count 1，幂等），resolve 关闭归零', () => {
    void useCloseConfirmStore.getState().request('a.ts');
    expect(useOverlayStore.getState().count).toBe(1);

    // 并发第二个请求不重复计数（overlay id 幂等）
    void useCloseConfirmStore.getState().request('b.ts');
    expect(useOverlayStore.getState().count).toBe(1);

    useCloseConfirmStore.getState().resolve('cancel');
    expect(useOverlayStore.getState().count).toBe(0);
  });
});
