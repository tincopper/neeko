/**
 * `team_close` 的**确认文案**（唯一产出点）。
 *
 * # 为什么文案必须与后端 `notes` 同口径
 *
 * 关闭团队这件事有三处「看起来做了其实没做」的陷阱（见 `execution.rs::close_notes`）：
 * `graceful` 没有协议可发、队长自己的 PTY 不由这次调用关掉、worktree 一个都不删。
 * 后端在**回复里**逐条说了出来（`ClosedReply.notes`），确认弹窗却在前端：如果这里写成
 * 「优雅关闭队长与全部成员，并清理工作树」，用户在按下按钮之前就已经被承诺了三件不会发生的
 * 事，而后端那句诚实话要等关闭成功后才出现 —— 那时已经没有选择权了。
 *
 * 所以本函数的每一行都能在 `notes` / `finish_member_close` 找到出处：
 *
 * | 文案 | 出处 |
 * | --- | --- |
 * | 直接关进程（`graceful` 未兑现） | `close_notes` 第 1 条（`graceful=true` 时恒发）|
 * | 队长终端不关 | `close_notes` 第 2 条（整队关闭时恒发）|
 * | worktree 保留 | `close_notes` 第 3 条（有 worktree 时逐路径发）|
 * | 在飞任务回 `pending` | `finish_member_close`（`execution.rs` 的顺序契约）|
 *
 * **不要**在这里加「成员会被礼貌地通知」之类的话：PTY 没有可发的关机协议。
 */

export interface TeamClosePrompt {
  /** 对话框标题（带队名 —— 同一个面板里可能有多个队）。 */
  title: string;
  /** 后果逐条（一条一句，不合并：合并后总有一句被读丢）。 */
  lines: string[];
  /** 确认按钮文案。 */
  confirmLabel: string;
}

/** 整队关闭的确认文案（`member_id` 缺省的语义）。 */
export function describeTeamClose(teamName: string): TeamClosePrompt {
  return {
    title: `关闭团队「${teamName}」？`,
    lines: [
      '会关掉全部成员进程（不含队长）：`graceful` 本期未兑现 —— PTY 没有可发的关机协议，这次是直接关进程（请求会记进团队审计）。',
      '成员手上的在飞任务回到 `pending`，板上不会留下半途的「进行中」。',
      '队长自己的终端**不会**被这次关闭关掉（它就是正在跑这个面板的会话），需要你自己关那个 tab。',
      'worktree 一个都不会删（保留供人工检查）。',
      '有成员关不掉时，团队会停在 `closing` 而不是假装关干净了 —— 那时可以重试关闭。',
    ],
    confirmLabel: '确认关闭',
  };
}
