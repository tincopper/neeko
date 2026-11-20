/**
 * 团队**破坏性动作**的确认文案（唯一产出点）。
 *
 * 两个动作（`team_close` / `team_delete`）共用同一个 [`TeamPrompt`] 形状，因为弹窗只需要
 * 「标题 + 逐条后果 + 按钮文案」。但**内容分开产出**：它们说的不是同一件事 —— 关闭说的是
 * 「可重试、进程还在」，删除说的是「不可撤销、级联删掉」。写在一起（或者让调用方传两段
 * 文案进来）就会出现「删除的按钮配着关闭的后果」，而类型系统看不见。
 *
 * # 为什么文案必须与后端同口径
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

/** 确认弹窗要显示的三样（两个动作共用；不含任何动作语义）。 */
export interface TeamPrompt {
  /** 对话框标题（带队名 —— 同一个面板里可能有多个队）。 */
  title: string;
  /** 后果逐条（一条一句，不合并：合并后总有一句被读丢）。 */
  lines: string[];
  /** 确认按钮文案。 */
  confirmLabel: string;
}

/** 整队关闭的确认文案（`member_id` 缺省的语义）。 */
export function describeTeamClose(teamName: string): TeamPrompt {
  return {
    title: `Close team "${teamName}"?`,
    lines: [
      'Kills every member process (not the lead): `graceful` is not implemented this cycle — PTY has no shutdown protocol to send, so this kills the processes directly (the request is recorded in the team audit).',
      'In-flight tasks return to `pending`; the board keeps no half-way "in progress" rows.',
      "The lead's own terminal is **not** killed by this close (it is the session running this panel) — close that tab yourself.",
      'No worktrees are deleted (kept for manual inspection).',
      'If some members cannot be killed, the team stays in `closing` instead of pretending it finished — you can retry closing then.',
    ],
    confirmLabel: 'Close team',
  };
}

/**
 * `team_delete` 的**确认文案**（唯一产出点）。
 *
 * # 与关闭的文案为什么必须分开
 *
 * 关闭的可逆面是「重试」；删除的可逆面是**不存在**。两段文案写在一起时，用户会把
 * 「关掉」与「抹掉」当成同一个动作的两级 —— 而实际上前者留着一个可查的 `closed` 行
 * （花名册、任务板、审计全在），后者把整队从库里连根抽走。
 *
 * # 每一句都能在后端找到出处
 *
 * | 文案 | 出处 |
 * | --- | --- |
 * | 只对已关闭的队可用 | `manager::delete_team`（`active` / `closing` ⇒ `Conflict`）|
 * | 成员 / 任务 / 审计一起删 | `team_member` / `team_task` / `team_event` 的 `ON DELETE CASCADE` |
 * | 不可撤销 | 没有恢复路径（没有软删列，没有归档表）|
 * | worktree 仍然保留 | `delete_team` 不碰文件系统（与 `close_notes` 第 3 条同口径）|
 *
 * **不要**在这里加「会释放磁盘空间」之类的话：worktree 一个都不删，而库里那几行的体积
 * 用户根本感受不到 —— 那会变成一个为了推销按钮而编的理由。
 */
export function describeTeamDelete(teamName: string): TeamPrompt {
  return {
    title: `Delete team "${teamName}"?`,
    lines: [
      'This team is already closed (member processes exited); deleting only clears the records — that is why there is no "Cancel" to click.',
      'Team members, the task board and audit records are deleted together (cascade) — nothing is recoverable afterwards.',
      'Terminal tabs of the lead and members stay open: they no longer own processes — whether to close the tabs is up to you.',
      'No worktrees are deleted (files stay on disk, same as closing).',
    ],
    confirmLabel: 'Delete team',
  };
}
