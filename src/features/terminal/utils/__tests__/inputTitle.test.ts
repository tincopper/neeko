import { describe, expect, it, vi } from 'vitest';

import { createFirstLineCapture, createUserInputReporter } from '../inputTitle';

describe('createFirstLineCapture', () => {
  it('累积到回车才结算，只取第一行', () => {
    const capture = createFirstLineCapture();
    expect(capture.feed('g')).toBeNull();
    expect(capture.feed('it status')).toBeNull();
    expect(capture.feed('\r')).toBe('git status');
    // 之后的输入不再产生标题
    expect(capture.feed('ls\r')).toBeNull();
  });

  it('ESC 转义序列不参与命名（方向键 / 功能键不会污染缓冲区）', () => {
    const capture = createFirstLineCapture();
    expect(capture.feed('\u001b[A')).toBeNull();
    // 退格回删：标题不得留下被删掉的那个字符
    expect(capture.feed('ab\u007fc\r')).toBe('ac');
  });

  it('xterm 自己的协议应答不算用户输入（OSC 10 颜色报告曾变成标题乱码）', () => {
    const capture = createFirstLineCapture();
    // `ESC ] 10 ; rgb:3838/3a3a/4242 ST` —— CLI 查前景色时终端的应答，走的是 onData
    expect(capture.feed('\u001b]10;rgb:3838/3a3a/4242\u001b\\')).toBeNull();
    // DSR 光标位置应答同理
    expect(capture.feed('\u001b[12;40R')).toBeNull();
    // 之后用户真正敲的那行仍然是标题
    expect(capture.feed('hello\r')).toBe('hello');
  });

  it('协议应答不会污染缓冲区（先应答、后输入 ⇒ 标题干净）', () => {
    const capture = createFirstLineCapture();
    capture.feed('\u001b]10;rgb:3838/3a3a/4242\u001b\\');
    expect(capture.feed('npm test\r')).toBe('npm test');
  });

  it('空回车不算一条输入，继续等真正的那一行', () => {
    const capture = createFirstLineCapture();
    expect(capture.feed('   \r')).toBeNull();
    expect(capture.feed('npm test\r')).toBe('npm test');
  });

  it('粘贴超长文本：保留上限（后端还会按字符截到 80）', () => {
    const capture = createFirstLineCapture();
    const line = capture.feed(`${'a'.repeat(500)}\r`);
    expect(line).toHaveLength(240);
  });

  it('回车前后空白被裁剪（与后端 title::truncate 同口径）', () => {
    const capture = createFirstLineCapture();
    expect(capture.feed('  修复登录竞态  \r')).toBe('修复登录竞态');
  });

  it('中文不会被切半个字（退格也按码点回删）', () => {
    const capture = createFirstLineCapture();
    expect(capture.feed('修复登录竞态\r')).toBe('修复登录竞态');

    const second = createFirstLineCapture();
    second.feed('修复登录竞争');
    expect(second.feed('\u007f态\r')).toBe('修复登录竞态', 'DEL 回删一个字符再重打');
  });

  it('bracketed paste 是用户输入，标记本身不参与标题', () => {
    const capture = createFirstLineCapture();
    expect(capture.feed('\u001b[200~npm test\u001b[201~')).toBeNull();
    expect(capture.feed('\r')).toBe('npm test');
  });

  it('多行 bracketed paste 只取首行，后续行不参与标题', () => {
    const capture = createFirstLineCapture();
    expect(capture.feed('\u001b[200~git status\nrm -rf build\u001b[201~')).toBe('git status');
    expect(capture.feed('\r')).toBeNull();
  });

  it('bracketed paste 标记跨块到达时仍能识别内容', () => {
    const capture = createFirstLineCapture();
    expect(capture.feed('\u001b[200~git sta')).toBeNull();
    expect(capture.feed('tus\u001b[201~')).toBeNull();
    expect(capture.feed('\r')).toBe('git status');
  });

  it('bracketed paste 起始标记本身跨块时不得泄漏成正文', () => {
    const capture = createFirstLineCapture();
    expect(capture.feed('\u001b[20')).toBeNull();
    expect(capture.feed('0~npm test\u001b[201~\r')).toBe('npm test');
  });

  it('bracketed paste 结束标记本身跨块时仍能正确闭合', () => {
    const capture = createFirstLineCapture();
    expect(capture.feed('\u001b[200~npm test\u001b[20')).toBeNull();
    expect(capture.feed('1~\r')).toBe('npm test');
  });

  it('普通 CSI 序列跨块时整体丢弃，不把尾段当成用户输入', () => {
    const capture = createFirstLineCapture();
    expect(capture.feed('\u001b[')).toBeNull();
    expect(capture.feed('A\r')).toBeNull();
    expect(capture.feed('npm test\r')).toBe('npm test');
  });

  it('OSC 协议应答跨块时整体丢弃，不污染后续标题', () => {
    const capture = createFirstLineCapture();
    expect(capture.feed('\u001b]10;')).toBeNull();
    expect(capture.feed('rgb:3838/3a3a/4242')).toBeNull();
    expect(capture.feed('\u001b\\')).toBeNull();
    expect(capture.feed('npm test\r')).toBe('npm test');
  });

  it('bracketed paste 结束后同块的回车仍然结算', () => {
    const capture = createFirstLineCapture();
    expect(capture.feed('\u001b[200~npm test\u001b[201~\r')).toBe('npm test');
  });

  it('bracketed paste 结束后同块的普通字符与回车仍属于同一行', () => {
    const capture = createFirstLineCapture();
    expect(capture.feed('\u001b[200~git\u001b[201~ status\r')).toBe('git status');
  });

  it('跨块粘贴 emoji 仍按码点保留上限，不会因 UTF-16 长度提前丢弃', () => {
    const capture = createFirstLineCapture();
    const emoji = '😀';
    expect(capture.feed(`\u001b[200~${emoji.repeat(130)}`)).toBeNull();
    expect(capture.feed(`${emoji.repeat(130)}\u001b[201~\r`)).toBe(emoji.repeat(240));
  });
});

describe('createUserInputReporter', () => {
  it('只把「第一行」上报一次，之后不再上报', () => {
    const report = vi.fn();
    const feed = createUserInputReporter({ getSessionId: () => 'pty-1', report });
    feed('ls');
    feed('\r');
    feed('pwd\r');
    expect(report).toHaveBeenCalledTimes(1);
    expect(report).toHaveBeenCalledWith('pty-1', 'ls');
  });

  it('会话 id 还没就绪（PTY 未创建）⇒ 不上报，也不记基线外的状态', () => {
    const report = vi.fn();
    const feed = createUserInputReporter({ getSessionId: () => null, report });
    feed('ls\r');
    expect(report).not.toHaveBeenCalled();
  });

  it('协议应答不触发上报（OSC 10 曾被当成输入）', () => {
    const report = vi.fn();
    const feed = createUserInputReporter({ getSessionId: () => 'pty-1', report });
    feed('\u001b]10;rgb:3838/3a3a/4242\u001b\\');
    feed('\r');
    expect(report).not.toHaveBeenCalled();
  });
});
