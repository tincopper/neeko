/**
 * `config.json` 写入的**串行门**。
 *
 * ## 为什么需要（第一性原理）
 *
 * `config.json` 是**一份**共享可变资源，但写入者横跨多个域，且每个都用
 *「读整份 → 改自己那几个键 → 写整份」的 RMW（后端 `save_config` **不做补丁**，整份覆盖）。
 * 只要两次 RMW **交叠**，后完成的那次就会用自己那份陈旧快照覆盖对方的键。
 *
 * 并发控制必须落在**资源**上，而不是每个访问者身上 —— 各调用方自建 `useRef` 串行链
 * **解决不了**：链是 per-module 的，两条链之间没有任何排序。本模块就是这个共享队列。
 *
 * ## 两个必须同时满足的条件
 *
 * 1. **不交叠**：由本队列保证。
 * 2. **不用过期的读**：队列**只**挡交叠，挡不住「我手里是启动时的快照」。
 *    故「读」必须与「写」在**同一个临界区**内。
 *
 * ## 写入面清单与各自的分工（改代码前请对照）
 *
 * | 写入面 | 入口 | 排队处 | 读在哪 |
 * | --- | --- | --- | --- |
 * | 设置页各面板（外观 / 快捷键 / LSP …） | `useAppConfig.saveConfig` | 写点内部 | **临界区内** |
 * | CLI hook 逐项开关 | `CliHooksSection` → `patchConfig` | `patchConfig` 内部 | **临界区内** |
 * | 隐藏 agent 开关 | `useHiddenAgentToggle` → `saveConfig` | 写点内部 | **临界区内**（updater 形态） |
 * | 通知设置 | `notification_settings_set`（后端 RMW） | 本组件 | 后端一次 IPC 内 |
 * | 项目引导状态 | `onboardingApi.saveOnboardingState` | 模块内 | 临界区内 |
 * | AgentSelector 偏好 | `AgentSelector.saveConfigToBackend` | 模块内 | 临界区内 |
 *
 * **关键约定**：`useAppConfig.saveConfig` 是「整份 AppConfig」的唯一写点，它**自己**
 * 在队列内重新读盘并把增量盖在磁盘现值上。因此经它写入的调用方**不得**再包一层
 * `runConfigWrite` —— 那会在队列内二次入队，**自我等待成死锁**
 *（`__tests__/configWriteGate.test.ts` 有专门的死锁反证用例）。
 *
 * ## 用法
 *
 * ```ts
 * // 直接写后端 RMW（不经过 saveConfig 的写入面）：
 * await runConfigWrite(async () => {
 *   const cfg = await loadConfig();          // 读在区内
 *   await saveConfig({ ...cfg, [k]: v });    // 写紧随其后
 * });
 * ```
 *
 * 队列不吞异常：失败会传播给调用方，同时**不影响后续任务**（链在 catch 后继续）。
 */

/** 模块级串行链（所有 config 写入共享一个顺序）。 */
let chain: Promise<unknown> = Promise.resolve();

/**
 * 把一次 config 读改写作为一个**不可交叠**的整体执行。
 *
 * @param task 临界区：内部完成「读 → 改 → 写」。
 * @returns `task` 的返回值（异常原样抛出，且不阻塞后续任务）。
 */
export function runConfigWrite<T>(task: () => Promise<T>): Promise<T> {
  // 用 `then(task, task)` 而非 `then(task)`：前一个任务失败不得卡死整条队列，
  // 但当前任务的失败必须如实抛给调用方（故不能在链上 catch 掉）。
  const next = chain.then(task, task);
  chain = next.catch(() => undefined);
  return next;
}

/** 仅供测试：清空队列（避免用例间互相串扰）。 */
export function __resetConfigWriteGateForTests(): void {
  chain = Promise.resolve();
}
