import { describe, expect, it } from 'vitest';

import { createMemberStatus } from '@/testing/factories';

import { hasResumableMember, openTerminalAction } from '../memberTerminal';

/**
 * 「打开会话」的**五态**判据。
 *
 * 每个态都必须：① 判据正确；② 打不开时有一个**可见**理由（不是只进 title —— `disabled`
 * 元素不可聚焦，键盘与读屏用户拿不到它）。
 *
 * 五个态的划分依据是**三个正交的事实**（v22 起它们是三个字段，不是一个状态机）：
 *
 * | 事实 | 来源 | 回答 |
 * | --- | --- | --- |
 * | `session.live` | `live_sessions` 注册表（运行态）| 现在有没有进程 |
 * | `resumable` | 后端（原生 id + 该 CLI 的续接形态）| 进程没了还接不接得回来 |
 * | `sealed` | 成员行落库（用户意图）| 用户关掉过没有 |
 *
 * 合成一个判据，就会出现「收尾窗口里的成员被显示成已退出」或「崩掉的成员被当成用户关掉了」——
 * 而这两种误判导向**相反**的恢复动作。`resumable` 与 `sealed` 也必须分开：
 * 「能接回来」与「允许接回来」是两句话，封存的成员照样有原生 id。
 */
describe('openTerminalAction', () => {
  it('① 有活会话：可点，接管那个 PTY', () => {
    const action = openTerminalAction(createMemberStatus({ memberId: 'w1@tm_1' }));

    expect(action).toEqual({ enabled: true, label: '打开会话', reason: null, kind: 'live' });
  });

  it('② 没有活会话、有原生会话 id 且可恢复、未被封存：可点，走 `resume`（起新进程续接）', () => {
    // 这正是用户报障的那个态：app 重启后成员的进程没了，但对话还应该接得回来。
    const action = openTerminalAction({
      session: { live: false, terminalId: null },
      sealed: false,
      agentSessionId: 'native-abc',
      resumable: true,
    });

    expect(action).toEqual({ enabled: true, label: '恢复会话', reason: null, kind: 'resume' });
  });

  it('③ 没有活会话、有原生会话 id 但**不可恢复**：可点，退到「查看记录」而不是置灰', () => {
    // qoder / gemini 有原生 id 却没有续接语法：那是真实的能力差异，不是错误。
    // 置灰会让用户以为「它没说过话」，而记录就在磁盘上。
    const action = openTerminalAction({
      session: { live: false, terminalId: null },
      sealed: false,
      agentSessionId: 'native-abc',
      resumable: false,
    });

    expect(action).toEqual({ enabled: true, label: '查看记录', reason: null, kind: 'archive' });
  });

  it('④ 没有活会话、没有被封存、也没有原生会话 id：置灰，理由「暂无会话」', () => {
    const action = openTerminalAction(
      createMemberStatus({
        memberId: 'w1@tm_1',
        session: { live: false, terminalId: null },
      }),
    );

    expect(action.enabled).toBe(false);
    // 文案是中性措辞：只说「此刻没有可接管的终端」，不等于「这个成员不存在」。
    expect(action.reason).toBe('暂无会话');
    // 按钮文案保持不变：变的是「能不能点」，理由单独说 —— 否则按钮自己变成理由，动作就没了
    expect(action.label).toBe('打开会话');
  });

  it('⑤ 被封存且没有活会话、也没有原生会话 id：置灰，理由是「已关闭」', () => {
    // 与 ④ 的区别是**谁干的**：用户关掉了它（不可恢复），还是它没留下任何记录。
    // 两者都不可点，但理由不同 —— 用户看到「暂无会话」会去重试，看到「已关闭」不会。
    const action = openTerminalAction(
      createMemberStatus({
        memberId: 'w1@tm_1',
        session: { live: false, terminalId: null },
        sealed: true,
      }),
    );

    expect(action.enabled).toBe(false);
    expect(action.reason).toBe('已关闭');
  });

  it('封存 + 有原生 id + 可恢复：`查看记录`，**不给** `恢复会话`（意图不许被撤销）', () => {
    // `resumable` 与 `sealed` 正交：前者是能力，后者是用户的决定。恢复一个已封存的成员
    // 等于撤销那个决定（后端也会拒绝），所以 UI 连入口都不给 —— 但记录照看。
    const action = openTerminalAction({
      session: { live: false, terminalId: null },
      sealed: true,
      agentSessionId: 'native-abc',
      resumable: true,
    });

    expect(action).toEqual({ enabled: true, label: '查看记录', reason: null, kind: 'archive' });
  });

  it('封存但有原生会话 id：仍可查看记录（意图不等于删档）', () => {
    const action = openTerminalAction({
      session: { live: false, terminalId: null },
      sealed: true,
      agentSessionId: 'native-abc',
      resumable: false,
    });

    expect(action).toEqual({ enabled: true, label: '查看记录', reason: null, kind: 'archive' });
  });

  it('收尾窗口里的封存成员：活会话优先（那时能用的是接管它，不是看记录）', () => {
    // 用户点了关闭，进程还没退干净。三个事实同时为真：live / resumable / sealed。
    // 判据顺序的第一条（`session.live` 最先）就是为这个态存在的。
    const action = openTerminalAction({
      session: { live: true, terminalId: 'term-closing' },
      sealed: true,
      agentSessionId: 'native-abc',
      resumable: true,
    });

    expect(action).toEqual({ enabled: true, label: '打开会话', reason: null, kind: 'live' });
  });

  it('`resumable` 但没有原生 id（不该出现的组合）：不给恢复，只置灰', () => {
    // 后端保证 `resumable ⇒ agentSessionId !== null`，但判据是防御式的：没有 id 就没有
    // 可续接的会话，此时**绝不**起一个裸 CLI（那会给出一个空对话，正是要修的缺陷）。
    const action = openTerminalAction({
      session: { live: false, terminalId: null },
      sealed: false,
      agentSessionId: null,
      resumable: true,
    });

    expect(action.enabled).toBe(false);
    expect(action.kind).toBe('live');
    expect(action.reason).toBe('暂无会话');
  });

  it('判据只看会话与意图（role / state 都不影响能不能看到终端）', () => {
    const lead = openTerminalAction(
      createMemberStatus({
        memberId: 'lead@tm_1',
        role: 'lead',
        session: { live: true, terminalId: 'term-lead' },
      }),
    );
    const offline = openTerminalAction(
      createMemberStatus({
        memberId: 'w2@tm_1',
        state: 'offline',
        session: { live: true, terminalId: 'term-dead' },
      }),
    );

    // 队长没有特权；运行态是 offline 但注册表说还活着时，以注册表为准 —— 成员行的
    // `state` 是**事件驱动**的投影，可能滞后于进程（它是回放，不是探针）。
    expect(lead.enabled).toBe(true);
    expect(offline.enabled).toBe(true);
  });
});

/**
 * 头部「恢复团队」的显隐判据。
 *
 * 它必须走**同一个** `openTerminalAction`：另写一份 `!live && resumable` 会让「头部按钮亮着、
 * 每一行都写着查看记录」这种自相矛盾的界面成为可能（而且两处一旦漂移，没有任何一处会报错）。
 */
describe('hasResumableMember', () => {
  it('一个可恢复的离线成员就够（头部按钮出现）', () => {
    expect(
      hasResumableMember([
        createMemberStatus({ memberId: 'a@tm_1' }),
        createMemberStatus({
          memberId: 'b@tm_1',
          session: { live: false, terminalId: null },
          agentSessionId: 'native-b',
          resumable: true,
        }),
      ]),
    ).toBe(true);
  });

  it('活着的成员不算（进程在，恢复是幂等的空动作，没有按钮的意义）', () => {
    expect(hasResumableMember([createMemberStatus({ memberId: 'a@tm_1' })])).toBe(false);
  });

  it('封存的成员不算（头部入口不得撤销用户的决定）', () => {
    expect(
      hasResumableMember([
        createMemberStatus({
          memberId: 'a@tm_1',
          session: { live: false, terminalId: null },
          agentSessionId: 'native-a',
          resumable: true,
          sealed: true,
        }),
      ]),
    ).toBe(false);
  });

  it('有原生 id 但该 CLI 不能续接的不算（它会显示「查看记录」）', () => {
    expect(
      hasResumableMember([
        createMemberStatus({
          memberId: 'a@tm_1',
          session: { live: false, terminalId: null },
          agentSessionId: 'native-a',
          resumable: false,
        }),
      ]),
    ).toBe(false);
  });

  it('空花名册 ⇒ false（不渲染一个点了只会「恢复 0 个成员」的按钮）', () => {
    expect(hasResumableMember([])).toBe(false);
  });
});
