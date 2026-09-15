import { beforeEach, describe, expect, it } from 'vitest';

import { confirmAction, setConfirmHostMounted, useConfirmStore } from '../confirmStore';

const REQUEST = {
  title: 'Proceed?',
  message: 'body',
  confirmLabel: 'Proceed',
};

describe('confirmStore — 应用级确认入口（替代 window.confirm）', () => {
  beforeEach(() => {
    useConfirmStore.setState({ pending: null });
    setConfirmHostMounted(false);
  });

  it('宿主未挂载 → 立即按取消结算（fail-closed，绝不永久挂起）', async () => {
    // 关键性质：无宿主时 Promise 必须 resolve，否则调用方（runner）会永久 await。
    await expect(confirmAction(REQUEST)).resolves.toBe(false);
    expect(useConfirmStore.getState().pending).toBeNull();
  });

  it('宿主已挂载 → 弹出 pending；确认后 resolve(true) 并清空', async () => {
    setConfirmHostMounted(true);
    const answer = confirmAction(REQUEST);
    expect(useConfirmStore.getState().pending?.title).toBe('Proceed?');

    useConfirmStore.getState().resolve(true);
    await expect(answer).resolves.toBe(true);
    expect(useConfirmStore.getState().pending).toBeNull();
  });

  it('取消 / 遮罩关闭 → resolve(false)', async () => {
    setConfirmHostMounted(true);
    const answer = confirmAction(REQUEST);
    useConfirmStore.getState().resolve(false);
    await expect(answer).resolves.toBe(false);
  });

  it('并发请求 → 旧请求按取消结算（用户已转向新的确认）', async () => {
    setConfirmHostMounted(true);
    const first = confirmAction(REQUEST);
    const second = confirmAction({ ...REQUEST, title: 'Second?' });

    await expect(first).resolves.toBe(false);
    expect(useConfirmStore.getState().pending?.title).toBe('Second?');
    useConfirmStore.getState().resolve(true);
    await expect(second).resolves.toBe(true);
  });

  it('无待确认时 resolve 是空操作（不抛错）', () => {
    expect(() => useConfirmStore.getState().resolve(true)).not.toThrow();
  });
});
