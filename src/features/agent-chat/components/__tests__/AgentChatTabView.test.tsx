// eslint-disable-next-line no-restricted-imports -- 测试需直接断言 invoke 被调用（setup 已全局 mock）
import { invoke } from '@tauri-apps/api/core';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { SequencedEvent, StreamEvent } from '@/shared/types/agentChat';

import AgentChatTabView, { clearMessageCache } from '../AgentChatTabView';

vi.mock('@/features/agent/api/agentApi', () => ({
  listChatAgents: vi.fn(() =>
    Promise.resolve([
      { id: 'opencode', name: 'OpenCode', version: '1.0' },
      { id: 'claude-code', name: 'Claude Code', version: '1.0' },
    ]),
  ),
  listAgentModels: vi.fn(() => Promise.resolve([])),
  // AgentBadge 渲染 agent CLI 图标时消费
  resolveAgentIconSrc: vi.fn(() => null),
}));

vi.mock('@/features/file/api/fileApi', () => ({
  readDirTree: vi.fn(() => Promise.resolve([])),
  readFileContent: vi.fn(() =>
    Promise.resolve({
      path: 'src/auth/session.ts',
      content: 'export const session = 1;',
      size: 24,
      is_binary: false,
    }),
  ),
}));

// 共享 mock 对象：openAgentFile 跳转编辑器时调用 addTab/activateTab（同 handleSend 的 updateTab）。
const editorMock = vi.hoisted(() => ({
  tabs: {} as Record<string, unknown>,
  updateTab: vi.fn(),
  activateTab: vi.fn(),
  addTab: vi.fn(),
}));

vi.mock('@/shared/store/editorStore', () => ({
  useEditorStore: {
    getState: vi.fn(() => editorMock),
  },
}));

// 捕获 listen 注册的 handler，用于向组件注入 StreamEvent。
const mockListen = vi.fn();
vi.mock('@tauri-apps/api/event', () => ({
  listen: (...args: unknown[]) => mockListen(...args),
  emit: vi.fn(),
}));

const BASE_DATA = { kind: 'agent-chat' as const, agentId: 'opencode', sessionId: 's1' };

// 可控 rAF：流式批处理（text/reasoning delta 合并渲染）依赖它。
let rafCallbacks: Array<() => void> = [];
const rafStub = vi.fn((cb: FrameRequestCallback) => {
  rafCallbacks.push(() => cb(0));
  return rafCallbacks.length;
});
const cancelStub = vi.fn((id: number) => {
  rafCallbacks[id - 1] = () => {};
});

/** 同步执行所有已收集的 rAF 回调（模拟动画帧到达）。 */
function flushRaf() {
  const cbs = rafCallbacks;
  rafCallbacks = [];
  for (const cb of cbs) cb();
}

/** 注入一条事件但不触发 rAF flush（用于观察批处理窗口内的中间态）。 */
function emitRaw(payload: StreamEvent) {
  const handler = mockListen.mock.calls[0]?.[1] as
    | ((e: { payload: SequencedEvent }) => void)
    | undefined;
  expect(handler).toBeDefined();
  // SequencedEvent 经 serde(flatten) 序列化：事件字段与 seq 平铺在顶层
  // （`{ seq, type, session_id, ... }`，无嵌套 event 对象）。
  act(() => handler({ payload: { seq: 0, ...payload } }));
}

/** 向组件注入一条会话事件（session_id=s1，与 BASE_DATA.sessionId 对齐）并立即 flush 批处理。 */
function emitEvent(payload: StreamEvent) {
  emitRaw(payload);
  act(() => flushRaf());
}

/** 渲染视图并冲刷异步 promise（listChatAgents / listen 等），避免 act 警告。 */
async function renderView(projectId = 'test-project') {
  const utils = render(
    <AgentChatTabView tabKey="p1" tabId="t1" projectId={projectId} data={BASE_DATA} />,
  );
  await screen.findByTestId('agent-chat-tab');
  return utils;
}

describe('AgentChatTabView', () => {
  beforeAll(() => {
    // jsdom 无布局引擎：offsetWidth/offsetHeight 恒 0，@tanstack/react-virtual 的
    // observeElementRect 同步首调 getRect(element) 会以 0 高覆盖 initialRect，
    // 导致可视窗口为 0、虚拟列表不渲染任何消息。stub 为非零值保证消息可见。
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
      configurable: true,
      get: () => 800,
    });
    Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
      configurable: true,
      get: () => 720,
    });
  });

  afterAll(() => {
    delete (HTMLElement.prototype as unknown as { offsetHeight?: number }).offsetHeight;
    delete (HTMLElement.prototype as unknown as { offsetWidth?: number }).offsetWidth;
  });

  beforeEach(() => {
    clearMessageCache();
    vi.mocked(invoke).mockReset();
    vi.mocked(invoke).mockResolvedValue('s1');
    mockListen.mockReset();
    mockListen.mockImplementation(() => Promise.resolve(() => {}));
    rafCallbacks = [];
    rafStub.mockClear();
    cancelStub.mockClear();
    vi.stubGlobal('requestAnimationFrame', rafStub);
    vi.stubGlobal('cancelAnimationFrame', cancelStub);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('渲染聊天根容器与 composer', async () => {
    await renderView();

    expect(screen.getByTestId('agent-chat-tab')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Type a message...')).toBeInTheDocument();
  });

  it('系统横幅显示项目上下文', async () => {
    await renderView('my-project');

    expect(screen.getByText(/my-project/)).toBeInTheDocument();
    expect(screen.getByText(/会话已开始/)).toBeInTheDocument();
  });

  it('composer 包含模型选择器与参数选择器按钮', async () => {
    await renderView();

    await waitFor(() => {
      expect(screen.getByText('OpenCode')).toBeInTheDocument();
    });
    expect(screen.getByText('Build')).toBeInTheDocument();
    expect(screen.getByText('High')).toBeInTheDocument();
    expect(screen.getByTitle('Send')).toBeInTheDocument();
  });

  it('composer 仅保留有功能的附件按钮，死按钮不渲染', async () => {
    await renderView();

    expect(screen.getByTitle('Attach files')).toBeInTheDocument();
    // 无 onClick 绑定的装饰按钮一律不渲染（YAGNI）
    expect(screen.queryByTitle('Add image')).not.toBeInTheDocument();
    expect(screen.queryByTitle('Add folder')).not.toBeInTheDocument();
    expect(screen.queryByTitle('Mention')).not.toBeInTheDocument();
    expect(screen.queryByTitle('Voice note')).not.toBeInTheDocument();
  });

  it('composer-meta 不渲染假数据与重复的上下文计量', async () => {
    const { container } = await renderView();

    // 硬编码假成本与未实现的快捷键提示不得出现
    expect(screen.queryByText('$0.024')).not.toBeInTheDocument();
    expect(screen.queryByText(/⌘⇧M/)).not.toBeInTheDocument();
    // 上下文用量仅 footer 的 ContextWindowMeter（真实 total 计算，事件驱动渲染），meta 区不重复
    // eslint-disable-next-line testing-library/no-node-access, testing-library/no-container -- 结构关系断言（DOM 层级）必须用 closest/querySelector
    expect(container.querySelector('.composer-meta .ctx-meter')).toBeNull();
    // 快捷键提示与实际行为一致（Enter 发送 / Shift+Enter 换行）
    expect(screen.getByText(/Enter 发送/)).toBeInTheDocument();
  });

  it('发送后渲染右对齐用户气泡与时间戳', async () => {
    await renderView();

    const ta = screen.getByPlaceholderText('Type a message...') as HTMLTextAreaElement;
    fireEvent.change(ta, { target: { value: 'hello agent' } });
    fireEvent.click(screen.getByTitle('Send'));

    await waitFor(() => {
      expect(screen.getByText('hello agent')).toBeInTheDocument();
    });
    // 用户消息带 24 小时制时间戳（如 "14:32"，无 AM/PM）
    expect(screen.getByText(/\d{2}:\d{2}/)).toBeInTheDocument();
    expect(screen.queryByText(/(AM|PM)/)).not.toBeInTheDocument();
    // 发起 agent_stream
    expect(invoke).toHaveBeenCalledWith('agent_stream', expect.any(Object));
  });

  it('request_approval 事件渲染内联审批面板，Approve once 回执 allow=true', async () => {
    await renderView();

    emitEvent({
      type: 'request_approval',
      session_id: 's1',
      call_id: 'c1',
      tool: 'run_command',
      title: 'rm -rf node_modules && npm install',
      prompt: 'Approve this command?',
      cmd: 'rm -rf node_modules && npm install',
    });

    const panel = screen.getByTestId('approval-panel');
    expect(panel).toBeInTheDocument();
    expect(screen.getByText('Approve this command?')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Approve once'));
    expect(invoke).toHaveBeenCalledWith('agent_approve', {
      sessionId: 's1',
      callId: 'c1',
      allow: true,
    });
    expect(screen.queryByTestId('approval-panel')).not.toBeInTheDocument();
  });

  it('审批与澄清面板固定在滚动区外（composer 上方），不随消息流滚走', async () => {
    const { container } = await renderView();

    emitEvent({
      type: 'request_approval',
      session_id: 's1',
      call_id: 'c1',
      tool: 'run_command',
      title: 'npm install',
      prompt: 'Approve?',
      cmd: 'npm install',
    });
    emitEvent({
      type: 'user_input',
      session_id: 's1',
      turn_id: 't1',
      prompt: 'Choose storage:',
      options: ['A', 'B'],
    });

    // 长会话时面板必须始终可见：不得位于滚动容器 .wa-chat 内部
    // eslint-disable-next-line testing-library/no-node-access, testing-library/no-container -- 结构关系断言（DOM 层级）必须用 closest/querySelector
    expect(screen.queryByTestId('approval-panel').closest('.wa-chat')).toBeNull();
    // eslint-disable-next-line testing-library/no-node-access, testing-library/no-container -- 结构关系断言（DOM 层级）必须用 closest/querySelector
    expect(screen.queryByTestId('user-input-panel').closest('.wa-chat')).toBeNull();
    expect(container).toBeInTheDocument();
  });

  it('审批面板 Decline 回执 allow=false', async () => {
    await renderView();

    emitEvent({
      type: 'request_approval',
      session_id: 's1',
      call_id: 'c2',
      tool: 'edit_file',
      title: 'src/a.ts',
      prompt: 'Apply diff?',
      diff: '@@ -1 +1 @@\n-old\n+new',
    });

    fireEvent.click(screen.getByText('Decline'));
    expect(invoke).toHaveBeenCalledWith('agent_approve', {
      sessionId: 's1',
      callId: 'c2',
      allow: false,
    });
  });

  it('Always allow this session 也回执 allow=true', async () => {
    await renderView();

    emitEvent({
      type: 'request_approval',
      session_id: 's1',
      call_id: 'c3',
      tool: 'run_command',
      title: 'npm install',
      prompt: 'Approve?',
      cmd: 'npm install',
    });

    fireEvent.click(screen.getByText('Always allow this session'));
    expect(invoke).toHaveBeenCalledWith('agent_approve', {
      sessionId: 's1',
      callId: 'c3',
      allow: true,
    });
    // 该工具被记忆：后续同类审批自动放行，不再弹面板
    emitEvent({
      type: 'request_approval',
      session_id: 's1',
      call_id: 'c4',
      tool: 'run_command',
      title: 'pnpm install',
      prompt: 'Approve?',
      cmd: 'pnpm install',
    });
    expect(screen.queryByTestId('approval-panel')).not.toBeInTheDocument();
    expect(invoke).toHaveBeenCalledWith('agent_approve', {
      sessionId: 's1',
      callId: 'c4',
      allow: true,
    });
  });

  it('user_input 事件渲染内联澄清面板，发送调用 agent_input', async () => {
    await renderView();

    emitEvent({
      type: 'user_input',
      session_id: 's1',
      turn_id: 't1',
      prompt: 'How should the refresh token be stored?',
      options: ['HttpOnly cookie', 'Local storage', 'Session storage'],
    });

    const panel = screen.getByTestId('user-input-panel');
    expect(panel).toBeInTheDocument();
    expect(screen.getByText('How should the refresh token be stored?')).toBeInTheDocument();

    // 单选模式：点击选项后自动提交
    fireEvent.click(screen.getByText('HttpOnly cookie'));
    expect(invoke).toHaveBeenCalledWith('agent_input', {
      sessionId: 's1',
      turnId: 't1',
      prompt: 'HttpOnly cookie',
    });
    expect(screen.queryByTestId('user-input-panel')).not.toBeInTheDocument();
  });

  it('file_diff 事件渲染 Files changed 卡片（含 +N/-N 统计）', async () => {
    await renderView();

    emitEvent({
      type: 'file_diff',
      session_id: 's1',
      call_id: 'c1',
      path: 'src/auth/session.ts',
      diff: '@@ -12,3 +12,7 @@\n-old\n+new',
    });

    const card = screen.getByTestId('files-changed-card');
    expect(card).toBeInTheDocument();
    expect(screen.getByText('Files changed')).toBeInTheDocument();
    expect(screen.getByText('src/auth/session.ts')).toBeInTheDocument();
    expect(screen.getByText('+1')).toBeInTheDocument();
    expect(screen.getByText('-1')).toBeInTheDocument();
  });

  it('turn_start/tool_start/turn_end 渲染 worked-card 话轮摘要', async () => {
    await renderView();

    emitEvent({ type: 'turn_start', session_id: 's1', turn_id: 't1' });
    emitEvent({
      type: 'tool_start',
      session_id: 's1',
      call_id: 'c1',
      name: 'read_file',
      title: 'src/auth/session.ts',
    });
    emitEvent({ type: 'tool_end', session_id: 's1', call_id: 'c1', status: 'done' });
    emitEvent({ type: 'turn_end', session_id: 's1', turn_id: 't1', reason: 'completed' });

    const card = screen.getByTestId('worked-card');
    expect(card).toBeInTheDocument();
    expect(screen.getByText(/Worked for/)).toBeInTheDocument();
    expect(screen.getByText(/Searched 1 file/)).toBeInTheDocument();
  });

  it('话轮摘要（WorkedCard）中的 read_file 路径可点击打开文件', async () => {
    await renderView();
    editorMock.tabs = {};
    editorMock.addTab.mockClear();

    emitEvent({ type: 'turn_start', session_id: 's1', turn_id: 't1' });
    emitEvent({
      type: 'tool_start',
      session_id: 's1',
      call_id: 'c1',
      name: 'read_file',
      title: 'src/auth/session.ts',
    });
    emitEvent({ type: 'tool_end', session_id: 's1', call_id: 'c1', status: 'done' });
    emitEvent({ type: 'turn_end', session_id: 's1', turn_id: 't1', reason: 'completed' });

    // turn_end 后消息同时含消息级 tools 与 worked 摘要，各渲染一个 read_file 行；
    // 验证 worked-card 内（透传 onOpenFile）的路径可点击。
    const workedCard = screen.getByTestId('worked-card');
    const links = within(workedCard).getAllByTestId('file-path-link');
    expect(links).toHaveLength(1);
    fireEvent.click(links[0]);
    await waitFor(() => {
      expect(editorMock.addTab).toHaveBeenCalledTimes(1);
    });
    const [, tab] = editorMock.addTab.mock.calls[0];
    expect(tab.data).toMatchObject({ filePath: 'src/auth/session.ts' });
  });

  it('分组折叠（≥2 连续 read_file）内的路径可点击打开文件（透传 onOpenFile）', async () => {
    await renderView();
    editorMock.tabs = {};
    editorMock.addTab.mockClear();

    emitEvent({ type: 'turn_start', session_id: 's1', turn_id: 't1' });
    // 连续两个 read_file 组成折叠组；running 状态使组默认展开
    emitEvent({
      type: 'tool_start',
      session_id: 's1',
      call_id: 'c1',
      name: 'read_file',
      title: 'src/a.ts',
    });
    emitEvent({
      type: 'tool_start',
      session_id: 's1',
      call_id: 'c2',
      name: 'read_file',
      title: 'src/b.ts',
    });
    emitEvent({ type: 'tool_end', session_id: 's1', call_id: 'c1', status: 'done' });
    emitEvent({ type: 'tool_end', session_id: 's1', call_id: 'c2', status: 'done' });

    // 相邻 tool blocks 合并分组：running 阶段挂载默认展开，完成后保持展开
    const links = screen.getAllByTestId('file-path-link');
    expect(links).toHaveLength(2);
    // 工具行归入摘要组的 body 内（而非逐行散渲染）
    // eslint-disable-next-line testing-library/no-node-access, testing-library/no-container -- 结构关系断言（DOM 层级）必须用 closest/querySelector
    expect(links[0].closest('.tool-group-body')).not.toBeNull();
    fireEvent.click(links[0]);
    await waitFor(() => {
      expect(editorMock.addTab).toHaveBeenCalledTimes(1);
    });
    const [, tab] = editorMock.addTab.mock.calls[0];
    expect(tab.data).toMatchObject({ filePath: 'src/a.ts' });
  });

  it('消息内相邻 tool blocks 合并分组：≥2 连续同类工具归入摘要行而非逐行散渲染', async () => {
    await renderView();

    emitEvent({
      type: 'tool_start',
      session_id: 's1',
      call_id: 'c1',
      name: 'read_file',
      title: 'src/a.ts',
    });
    emitEvent({
      type: 'tool_start',
      session_id: 's1',
      call_id: 'c2',
      name: 'read_file',
      title: 'src/b.ts',
    });
    emitEvent({ type: 'tool_end', session_id: 's1', call_id: 'c1', status: 'done' });
    emitEvent({ type: 'tool_end', session_id: 's1', call_id: 'c2', status: 'done' });

    // 摘要行存在（"Read 2 files"）
    expect(screen.getByText('Read 2 files')).toBeInTheDocument();
    // 所有工具行都归入摘要组 body，不存在组外的散行
    const links = screen.getAllByTestId('file-path-link');
    expect(links).toHaveLength(2);
    for (const link of links) {
      // eslint-disable-next-line testing-library/no-node-access, testing-library/no-container -- 结构关系断言（DOM 层级）必须用 closest/querySelector
      expect(link.closest('.tool-group-body')).not.toBeNull();
    }
  });

  it('command_run 事件渲染 Codex 风格命令卡并计入话轮', async () => {
    await renderView();

    emitEvent({
      type: 'command_run',
      session_id: 's1',
      call_id: 'cmd1',
      cwd: '/tmp',
      cmd: 'cargo check',
    });

    const card = screen.getByTestId('command-card');
    expect(card).toBeInTheDocument();
    expect(screen.getByText('cargo check')).toBeInTheDocument();
    expect(card).toHaveClass('running');
  });

  it('command_run 之后的结果文本另起一段，不与前面的说明糅合', async () => {
    await renderView();

    emitEvent({ type: 'text_delta', session_id: 's1', delta: '现在执行一条命令来验证修改。' });
    emitEvent({
      type: 'command_run',
      session_id: 's1',
      call_id: 'cmd1',
      cwd: '/tmp',
      cmd: 'cargo check',
    });
    emitEvent({ type: 'text_delta', session_id: 's1', delta: '✅ 命令已执行：$ cargo check' });

    const paragraphs = screen.getAllByRole('paragraph');
    expect(paragraphs).toHaveLength(2);
    expect(paragraphs[0]).toHaveTextContent('现在执行一条命令来验证修改。');
    expect(paragraphs[1]).toHaveTextContent('✅ 命令已执行：$ cargo check');
  });

  it('tool_output 事件将输出累积到命令卡并渲染', async () => {
    await renderView();

    emitEvent({
      type: 'tool_start',
      session_id: 's1',
      call_id: 'c1',
      name: 'bash',
      title: 'echo hi',
    });
    emitEvent({ type: 'tool_output', session_id: 's1', call_id: 'c1', output: 'hi\n' });
    emitEvent({ type: 'tool_end', session_id: 's1', call_id: 'c1', status: 'done' });

    // 命令卡默认可折叠，点击展开后显示输出
    fireEvent.click(screen.getByTestId('command-card-header'));
    const output = screen.getByTestId('command-output');
    expect(output).toHaveTextContent('hi');
  });

  it('read_file 不显示文件内容，路径可点击（file-path-link）', async () => {
    await renderView();

    emitEvent({
      type: 'tool_start',
      session_id: 's1',
      call_id: 'c1',
      name: 'read_file',
      title: 'src/auth/session.ts',
    });
    emitEvent({
      type: 'tool_output',
      session_id: 's1',
      call_id: 'c1',
      output: 'export const session = 1;\n',
    });
    emitEvent({ type: 'tool_end', session_id: 's1', call_id: 'c1', status: 'done' });

    // 不再渲染读取的文件内容
    expect(screen.queryByTestId('file-output')).not.toBeInTheDocument();
    expect(screen.queryByText('export const session = 1;')).not.toBeInTheDocument();
    // 路径仍显示且可点击
    const link = screen.getByTestId('file-path-link');
    expect(link).toHaveTextContent('src/auth/session.ts');
  });

  it('点击 read_file 路径调用 readFileContent + editorStore.addTab', async () => {
    await renderView();
    editorMock.tabs = {};
    editorMock.addTab.mockClear();

    emitEvent({
      type: 'tool_start',
      session_id: 's1',
      call_id: 'c1',
      name: 'read_file',
      title: 'src/auth/session.ts',
    });
    emitEvent({ type: 'tool_end', session_id: 's1', call_id: 'c1', status: 'done' });

    fireEvent.click(screen.getByTestId('file-path-link'));

    await waitFor(() => {
      expect(editorMock.addTab).toHaveBeenCalledTimes(1);
    });
    const [tabKey, tab] = editorMock.addTab.mock.calls[0];
    expect(tabKey).toBe('test-project');
    expect(tab).toMatchObject({
      id: 'test-project:src/auth/session.ts',
      projectId: 'test-project',
      title: 'session.ts',
      data: { kind: 'file', filePath: 'src/auth/session.ts', isDirty: false },
    });
  });

  it('read_file 路径已打开时点击只 activateTab 不重复 addTab', async () => {
    await renderView();
    editorMock.tabs = {
      'test-project': {
        tabs: [{ id: 'test-project:src/auth/session.ts', title: 'session.ts' }],
        activeTabId: 'test-project:src/auth/session.ts',
      },
    };
    editorMock.addTab.mockClear();
    editorMock.activateTab.mockClear();

    emitEvent({
      type: 'tool_start',
      session_id: 's1',
      call_id: 'c1',
      name: 'read_file',
      title: 'src/auth/session.ts',
    });
    emitEvent({ type: 'tool_end', session_id: 's1', call_id: 'c1', status: 'done' });

    fireEvent.click(screen.getByTestId('file-path-link'));

    await waitFor(() => {
      expect(editorMock.activateTab).toHaveBeenCalledWith(
        'test-project',
        'test-project:src/auth/session.ts',
      );
    });
    expect(editorMock.addTab).not.toHaveBeenCalled();
  });

  it('同一消息内渲染顺序为 思考 → 文本 → 工具（按时序）', async () => {
    await renderView();

    emitEvent({ type: 'reasoning_delta', session_id: 's1', delta: '先想清楚' });
    emitEvent({ type: 'text_delta', session_id: 's1', delta: '开始处理' });
    emitEvent({
      type: 'tool_start',
      session_id: 's1',
      call_id: 'c1',
      name: 'task',
      title: 'general Task: 扫描代码',
    });
    emitEvent({ type: 'tool_end', session_id: 's1', call_id: 'c1', status: 'done' });

    const content = screen.getByText('开始处理');
    // 思考文本同时出现在折叠条预览与展开体中，取首个（summary 内）匹配
    const reasoning = screen.getAllByText('先想清楚')[0];
    const row = screen.getByText('general Task: 扫描代码');
    // 思考最先到达 → 渲染在最前；文本其次；工具最后。
    expect(reasoning.compareDocumentPosition(content)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(content.compareDocumentPosition(row)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it('同一 rAF 批处理窗口内：先到达的文本意图仍渲染在工具卡片之前（先意图后工具）', async () => {
    await renderView();

    // 后端 mockAgent 一次 burst 连续发送：文本意图 → read_file 工具，
    // 中间没有经过动画帧 —— 文本 delta 还滞留在 rAF 批处理 buffer 中。
    emitRaw({ type: 'text_delta', session_id: 's1', delta: '让我先读取 adapter.rs 文件。' });
    emitRaw({
      type: 'tool_start',
      session_id: 's1',
      call_id: 'read_1',
      name: 'read_file',
      title: 'src-tauri/src/agent/chat/adapter.rs',
    });
    emitRaw({ type: 'tool_end', session_id: 's1', call_id: 'read_1', status: 'done' });

    // 动画帧到达，批处理 flush。
    act(() => flushRaf());

    const intent = screen.getByText('让我先读取 adapter.rs 文件。');
    const card = screen.getByText('src-tauri/src/agent/chat/adapter.rs');
    // 文本意图必须渲染在工具卡片之前，不能出现「工具在前、文本在后」。
    expect(intent.compareDocumentPosition(card)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it('同一 rAF 批处理窗口内：先到达的说明文本仍渲染在命令卡片之前', async () => {
    await renderView();

    emitRaw({ type: 'text_delta', session_id: 's1', delta: '现在执行一条命令来验证修改。' });
    emitRaw({
      type: 'command_run',
      session_id: 's1',
      call_id: 'cmd_1',
      cwd: '/tmp',
      cmd: 'cargo check --message-format=json',
    });
    emitRaw({ type: 'tool_output', session_id: 's1', call_id: 'cmd_1', output: 'Finished' });
    emitRaw({ type: 'tool_end', session_id: 's1', call_id: 'cmd_1', status: 'done' });

    act(() => flushRaf());

    const intent = screen.getByText('现在执行一条命令来验证修改。');
    const card = screen.getByText('cargo check --message-format=json');
    expect(intent.compareDocumentPosition(card)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it('todo_updated 渲染 Codex 风格任务清单', async () => {
    await renderView();

    emitEvent({ type: 'text_delta', session_id: 's1', delta: '开始规划' });
    emitEvent({
      type: 'todo_updated',
      session_id: 's1',
      todos: [
        { content: '阅读第一章', status: 'pending', priority: 'high' },
        { content: '写笔记', status: 'in_progress', priority: 'medium' },
        { content: '总结', status: 'completed', priority: 'low' },
      ],
    });

    const card = screen.getByTestId('todo-card');
    expect(card).toBeInTheDocument();
    const rows = screen.getAllByTestId('todo-row');
    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveTextContent('阅读第一章');
    expect(rows[1]).toHaveTextContent('写笔记');
    expect(rows[2]).toHaveTextContent('总结');
    // Codex 风格状态图标：completed ✓ / in_progress ◐ / pending ○
    expect(rows[0]).toHaveTextContent('○');
    expect(rows[1]).toHaveTextContent('◐');
    expect(rows[2]).toHaveTextContent('✓');
  });

  it('task 工具行显示子任务标题而非裸工具名', async () => {
    await renderView();

    emitEvent({
      type: 'tool_start',
      session_id: 's1',
      call_id: 'c1',
      name: 'task',
      title: 'general Task: 扫描代码库并总结模块边界',
    });

    const row = screen.getByText('general Task: 扫描代码库并总结模块边界');
    expect(row).toBeInTheDocument();
  });

  it('todowrite 工具行不重复单行渲染（由消息级列表接管）', async () => {
    await renderView();

    emitEvent({
      type: 'tool_start',
      session_id: 's1',
      call_id: 'c1',
      name: 'todowrite',
      title: '3 todos',
    });

    expect(screen.queryByText('3 todos')).not.toBeInTheDocument();
  });

  it('连续 text_delta 批处理为一次 rAF flush，flush 后文本完整拼接', async () => {
    await renderView();

    emitRaw({ type: 'text_delta', session_id: 's1', delta: '你' });
    emitRaw({ type: 'text_delta', session_id: 's1', delta: '好' });
    emitRaw({ type: 'text_delta', session_id: 's1', delta: '！' });

    // 批处理窗口内：只调度一次 rAF，尚未渲染
    expect(rafStub).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('你好！')).not.toBeInTheDocument();

    act(() => flushRaf());

    expect(rafStub).toHaveBeenCalledTimes(1);
    expect(screen.getByText('你好！')).toBeInTheDocument();
  });

  it('text 与 reasoning delta 按到达顺序批处理（不丢序，穿插保持流式语义）', async () => {
    await renderView();

    // 穿插到达：思考 → 文本 → 思考 → 文本
    emitRaw({ type: 'reasoning_delta', session_id: 's1', delta: '想' });
    emitRaw({ type: 'text_delta', session_id: 's1', delta: '开始' });
    emitRaw({ type: 'reasoning_delta', session_id: 's1', delta: '清楚' });
    emitRaw({ type: 'text_delta', session_id: 's1', delta: '处理' });

    act(() => flushRaf());

    // 新模型：穿插 delta 各自成 block，保持到达顺序
    // （思考文本在折叠条预览中也有副本，取首个匹配做时序断言）
    const reasoning1 = screen.getAllByText('想')[0];
    const content1 = screen.getByText('开始');
    const reasoning2 = screen.getAllByText('清楚')[0];
    const content2 = screen.getByText('处理');
    // 顺序：想 → 开始 → 清楚 → 处理
    expect(reasoning1.compareDocumentPosition(content1)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(content1.compareDocumentPosition(reasoning2)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(reasoning2.compareDocumentPosition(content2)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it('同一 callId 重复 tool_start 只渲染一行', async () => {
    await renderView();

    emitEvent({
      type: 'tool_start',
      session_id: 's1',
      call_id: 'c1',
      name: 'task',
      title: 'explore Task: 探索',
    });
    emitEvent({
      type: 'tool_start',
      session_id: 's1',
      call_id: 'c1',
      name: 'task',
      title: 'explore Task: 探索',
    });
    emitEvent({ type: 'tool_end', session_id: 's1', call_id: 'c1', status: 'done' });

    const rows = screen.getAllByText('explore Task: 探索');
    expect(rows).toHaveLength(1);
  });

  it('切换 agent 后发送消息创建新会话，不复用旧 agent 的 sessionId', async () => {
    const utils = await renderView(); // agentId='opencode', sessionId='s1'

    // 切到另一个 agent（tab data 的 agentId 变化）→ 会话必须重置，
    // 否则新 agent 的 prompt 会被后端路由到旧 agent 的会话（旧模型）。
    utils.rerender(
      <AgentChatTabView
        tabKey="p1"
        tabId="t1"
        projectId="test-project"
        data={{ kind: 'agent-chat', agentId: 'mockAgent', sessionId: 's1' }}
      />,
    );

    const ta = screen.getByPlaceholderText('Type a message...') as HTMLTextAreaElement;
    fireEvent.change(ta, { target: { value: 'hi' } });
    fireEvent.click(screen.getByTitle('Send'));

    await waitFor(() => {
      const call = vi.mocked(invoke).mock.calls.find((c) => c[0] === 'agent_stream');
      expect(call).toBeDefined();
      // invoke 第二参是 `{ req }`（命令签名 agent_stream(req, state, app_handle)）
      const req = (call?.[1] as { req?: { sessionId?: string } }).req;
      expect(req).toBeDefined();
      // 关键断言：新会话请求不得携带旧 sessionId
      expect(req?.sessionId).toBeUndefined();
    });
  });

  it('composer 不渲染调试用的模型计数残留', async () => {
    await renderView();

    await waitFor(() => {
      expect(screen.getByText('OpenCode')).toBeInTheDocument();
    });
    expect(screen.queryByText(/\d+ models/)).not.toBeInTheDocument();
  });

  it('思考过程默认折叠（details 无 open 属性），summary 无 emoji', async () => {
    await renderView();

    emitEvent({ type: 'reasoning_delta', session_id: 's1', delta: '先想清楚' });

    const summary = screen.getByText('Thinking');
    expect(summary).not.toHaveTextContent('💭');
    // eslint-disable-next-line testing-library/no-node-access, testing-library/no-container -- 结构关系断言（DOM 层级）必须用 closest/querySelector
    const details = summary.closest('details');
    expect(details).not.toBeNull();
    expect(details).not.toHaveAttribute('open');
  });

  it('context_init 后横幅展示工作目录（project_id 即 cwd 绝对路径，hover 可见全路径）', async () => {
    await renderView();

    emitEvent({
      type: 'context_init',
      session_id: 's1',
      project_id: '/Users/demo/RustroverProjects/neeko',
      project_name: 'neeko',
      env: 'local',
      skills: [],
      files: [],
      mode: 'confirm',
    });

    // 横幅可见工作目录路径
    expect(screen.getByText(/\/Users\/demo\/RustroverProjects\/neeko/)).toBeInTheDocument();
  });
});
