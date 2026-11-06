import { describe, it, expect, beforeEach } from 'vitest';

import { runConfigWrite, __resetConfigWriteGateForTests } from '@/shared/utils/configWriteGate';

/** 让出一拍事件循环，便于制造交叠窗口。 */
const tick = () => new Promise<void>((r) => setTimeout(r, 0));

describe('configWriteGate', () => {
  beforeEach(() => __resetConfigWriteGateForTests());

  it('串行化：后提交的任务必须等前一个完成后才开始', async () => {
    const order: string[] = [];
    const first = runConfigWrite(async () => {
      order.push('a:start');
      await tick();
      await tick();
      order.push('a:end');
    });
    // 故意在 first 还没结束时提交 second —— 模拟两条独立链的写入交叠。
    const second = runConfigWrite(async () => {
      order.push('b:start');
      order.push('b:end');
    });
    await Promise.all([first, second]);
    // 若未串行化，b:start 会插进 a:start 与 a:end 之间（这正是丢更新的根因）。
    expect(order).toEqual(['a:start', 'a:end', 'b:start', 'b:end']);
  });

  it('读改写作为整体不可交叠（模拟 config.json 的 RMW 丢更新）', async () => {
    // 模拟磁盘：两个调用者各自「读整份 → 改自己的键 → 写整份」。
    let disk: Record<string, number> = {};
    const readModifyWrite = async (key: string, value: number) => {
      const snapshot = { ...disk }; // 读
      await tick(); // 放大交叠窗口
      disk = { ...snapshot, [key]: value }; // 写整份
    };

    await Promise.all([
      runConfigWrite(() => readModifyWrite('a', 1)),
      runConfigWrite(() => readModifyWrite('b', 2)),
    ]);

    // 串行化后两个键都在；不串行时后写者会用陈旧快照覆盖前者（只剩一个键）。
    expect(disk).toEqual({ a: 1, b: 2 });
  });

  it('任务失败会传播给调用方，但不阻塞后续任务', async () => {
    const failing = runConfigWrite(async () => {
      throw new Error('boom');
    });
    await expect(failing).rejects.toThrow('boom');

    // 队列未被污染：后续任务照常执行。
    const after = await runConfigWrite(async () => 'ok');
    expect(after).toBe('ok');
  });

  it('返回值透传', async () => {
    await expect(runConfigWrite(async () => 42)).resolves.toBe(42);
  });

  it('嵌套入队会死锁 —— 故写点自带门时调用方不得再包一层', async () => {
    // 这条用例**钉住一个真实事故**（2026-10-16 审查后修复）：
    // `useAppConfigOwner.saveConfig` 内部进队以保证「读在临界区内」，
    // 而 `CliHooksSection` / `useHiddenAgentToggle` 当时又在外面包了一层
    // `runConfigWrite(() => saveConfig(...))` ⇒ 内层等待外层完成，外层等待内层，
    // 队列永久卡死（表现为「设置改了不保存、界面也不报错」）。
    //
    // 用超时来判定死锁：正常执行应在毫秒级完成。
    const withTimeout = <T>(p: Promise<T>, ms: number) =>
      Promise.race([
        p,
        new Promise<T>((_, reject) => setTimeout(() => reject(new Error('DEADLOCK')), ms)),
      ]);

    // 模拟「自带门」的写点。
    const saveConfigThatGatesItself = () => runConfigWrite(async () => 'saved');

    // 反例：外层再包一层 → 必须超时（证明这条约束是真约束，不是空话）。
    const nested = runConfigWrite(() => saveConfigThatGatesItself());
    await expect(withTimeout(nested, 150)).rejects.toThrow('DEADLOCK');

    // 正例：调用方直接调写点 → 正常完成（这就是修复后的形态）。
    // 注意 `nested` 已把队列卡住，故重置队列再测正例。
    __resetConfigWriteGateForTests();
    await expect(withTimeout(saveConfigThatGatesItself(), 150)).resolves.toBe('saved');
  });
});
