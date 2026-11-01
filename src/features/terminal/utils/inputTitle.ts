/**
 * 终端**用户提交输入行**的解析器（前端侧）。
 *
 * # 为什么在前端
 *
 * `terminal-input-{id}` 这条通道同时承载两类写入：
 *
 * 1. **我们自动启动 agent 的那行命令** —— `TerminalViewBase` 创建会话后立即写入
 *    `pi --approve\r`（见 `if (tabAgentId && !taskCommand)` 分支）；
 * 2. 用户在 `term.onData` 里敲的按键。
 *
 * 后端收到的是同一串字节，**无从区分**；只有前端知道某次写入是不是来自 `onData`。
 * 早期版本在后端解析字节流，结果一创建 tab 就把自动启动命令当成了首条输入，侧栏立刻
 * 冒出一条标题为 `pi --approve` 的会话 —— 这正是「一创建 Tab 就出现会话」的根因。
 *
 * # `onData` **也不全是用户输入**
 *
 * xterm 会把它**自己**对终端查询的应答从 `onData` 发出去 —— 例如 CLI 查前景色时回
 * `ESC ] 10 ; rgb:3838/3a3a/4242 ST`（OSC 10），查光标位置时回 `ESC [ 12 ; 40 R`（DSR）。
 * 这些字节没有任何「用户敲的字」，但混进来会变成标题：实测侧栏出现
 * `10;rgb:3838/3a3a/424211,…` 这种乱码。判据很干脆：**协议应答 / 转义序列整块丢弃**。
 * 例外是 bracketed paste：xterm 在 shell 开启该模式后会把用户粘贴内容包在
 * `ESC[200~ … ESC[201~` 里，标记属于传输协议，内容仍来自用户。
 *
 * # 规则（与后端 `title::truncate` 的口径一致）
 *
 * - bracketed paste 标记剥离后按用户输入处理；
 * - 其余 ESC 序列（CSI / OSC / DCS / 字符集等）整段丢弃，且支持跨 `onData` 分块；
 * - 累积到**回车**才结算（输入按键盘分块到达，一次一个键）；
 * - 退格（`DEL` / `BS`）回删缓冲区最后一个字符 —— 用户改错字时标题不该留着被删掉的字；
 * - 其余控制字符（制表等）不进标题；
 * - 默认标题捕获忽略空回车；活动上报把空回车视为一次用户提交；
 * - 默认只取第一条非空行；活动上报器关闭该限制，每次提交都回调（后续提交只恢复状态，
 *   后端会忽略已有真标题时的 `Prompt` 改名）；
 */

/** 保留上限：后端还会按字符截到 80，这里只为防粘贴大段文本。 */
const MAX_CHARS = 240;

/** bracketed paste 的传输标记（内容不属于标记）。 */
const PASTE_START = '\u001b[200~';
const PASTE_END = '\u001b[201~';

/** 退格：`BS`（部分终端的 Ctrl+Backspace）与 `DEL`（xterm 默认）。 */
const is_backspace = (code: number): boolean => code === 0x08 || code === 0x7f;

export interface InputLineCapture {
  /**
   * 喂入一段输入；返回本次结算的第一条行（空行可能返回 `''`）。
   */
  feed: (data: string) => string | null;
}

interface LineCaptureOptions {
  /** 只结算首行（默认 `true`）；活动上报需要观察每次提交。 */
  stopAfterFirst?: boolean;
  /** 是否把空回车结算为一次提交（默认 `false`）。 */
  includeEmpty?: boolean;
  /** 每结算一行调用一次；同一数据块可包含多次提交。 */
  onSubmit?: (line: string) => void;
}

function createLineCapture(options: LineCaptureOptions = {}): InputLineCapture {
  const stopAfterFirst = options.stopAfterFirst ?? true;
  const includeEmpty = options.includeEmpty ?? false;
  const onSubmit = options.onSubmit;
  // 按**码点**存：退格要回删一个字符，用字符串拼接删不掉一个代理对。
  let buf: string[] = [];
  let done = false;
  /** 尚未判定完的转义序列（可能只是 bracketed paste 标记的前缀）。 */
  let pendingEscape = '';
  /** 粘贴块内已确认不是结束标记的内容。 */
  let pasted = '';
  /** 粘贴块末尾可能是结束标记前缀的少量字符，不能先并入正文。 */
  let pasteTail = '';
  let inPaste = false;

  return {
    feed(data: string): string | null {
      if (stopAfterFirst && done) return null;
      return inPaste ? processPaste(data) : processNormal(pendingEscape + data);
    },
  };

  /**
   * 普通状态解析。
   *
   * 转义序列可能跨 `onData` 分块到达：不完整的 CSI / OSC / 粘贴标记必须保留到下一块，
   * 否则尾段会被当成正文。完整协议序列只丢弃序列本身，后续普通输入继续解析。
   */
  function processNormal(data: string): string | null {
    let rest = data;
    let first: string | null = null;
    pendingEscape = '';
    while (rest.length > 0) {
      const escapeAt = rest.indexOf('\u001b');
      if (escapeAt < 0) {
        const line = consume(rest);
        return first ?? line;
      }

      if (escapeAt > 0) {
        const line = consume(rest.slice(0, escapeAt));
        if (line !== null && stopAfterFirst) return line;
        first ??= line;
        rest = rest.slice(escapeAt);
      }

      if (PASTE_START.startsWith(rest) && rest.length < PASTE_START.length) {
        pendingEscape = rest;
        return first;
      }
      if (rest.startsWith(PASTE_START)) {
        inPaste = true;
        const line = processPaste(rest.slice(PASTE_START.length));
        return first ?? line;
      }

      const sequence = escapeSequenceLength(rest);
      if (sequence === 0) {
        pendingEscape = rest;
        return first;
      }
      rest = rest.slice(sequence);
    }
    return first;
  }

  /**
   * 返回完整转义序列长度；0 = 当前块只有前缀，需保留等待后续数据。
   *
   * 只覆盖终端输入会遇到的形态：CSI、OSC/DCS 等字符串、字符集指定、两字节转义。
   * bracketed paste 的完整起始标记由调用方先处理。
   */
  function escapeSequenceLength(data: string): number {
    if (data.length < 2) return 0;
    const kind = data[1];
    if (kind === '[') {
      for (let i = 2; i < data.length; i += 1) {
        const code = data.charCodeAt(i);
        if (code >= 0x40 && code <= 0x7e) return i + 1;
      }
      return 0;
    }
    if (kind === ']' || kind === 'P' || kind === 'X' || kind === '^' || kind === '_') {
      for (let i = 2; i < data.length; i += 1) {
        if (data[i] === '\u0007') return i + 1;
        if (data[i] === '\u001b') {
          if (i + 1 >= data.length) return 0;
          if (data[i + 1] === '\\') return i + 2;
        }
      }
      return 0;
    }
    if ('()*+-./#%'.includes(kind)) {
      return data.length >= 3 ? 3 : 0;
    }
    // 普通两字节转义（Alt+键、单字符 F1 变体等）不参与标题。
    return 2;
  }

  /** bracketed paste 状态：内容允许含换行和控制字符，只认完整的结束标记。 */
  function processPaste(data: string): string | null {
    const combined = pasteTail + data;
    const end = combined.indexOf(PASTE_END);
    if (end < 0) {
      // 按**码点**保留尾部探针：按 UTF-16 切片会把 emoji 的代理对切成两半。
      const chars = Array.from(combined);
      const keep = Math.min(chars.length, PASTE_END.length - 1);
      pasted = appendPaste(pasted, chars.slice(0, chars.length - keep).join(''));
      pasteTail = chars.slice(chars.length - keep).join('');
      return null;
    }

    pasted = appendPaste(pasted, combined.slice(0, end));
    const line = consume(pasted);
    pasted = '';
    pasteTail = '';
    inPaste = false;
    if (line !== null && stopAfterFirst) return line;
    const trailing = processNormal(combined.slice(end + PASTE_END.length));
    return line ?? trailing;
  }

  function appendPaste(current: string, next: string): string {
    const chars = Array.from(current);
    if (chars.length >= MAX_CHARS) return current;
    // 只遍历到上限，避免大段粘贴先被 Array.from 全量展开；按码点保留 emoji。
    for (const ch of next) {
      if (chars.length >= MAX_CHARS) break;
      chars.push(ch);
    }
    return chars.join('');
  }

  function consume(data: string): string | null {
    let first: string | null = null;
    for (const ch of data) {
      if (ch === '\r' || ch === '\n') {
        const line = buf.join('').trim();
        buf = [];
        if (!line && !includeEmpty) continue;
        if (stopAfterFirst) done = true;
        onSubmit?.(line);
        if (first === null) first = line;
        // 默认捕获器只关心首行，结算后不再扫描同块的后续字节。
        if (stopAfterFirst) return first;
        continue;
      }
      const code = ch.codePointAt(0) ?? 0;
      if (is_backspace(code)) {
        buf.pop();
        continue;
      }
      // 其余控制字符（制表等）不进标题。
      if (code < 0x20) continue;
      if (buf.length < MAX_CHARS) buf.push(ch);
    }
    return first;
  }
}

/** 默认终端标题捕获器：只结算第一条非空输入行。 */
export function createFirstLineCapture(): InputLineCapture {
  return createLineCapture();
}

/**
 * 「用户提交输入 → 上报」的包装：内部持有捕获器，返回可直接用作 `sendInput` 副作用的函数。
 *
 * 每次非协议输入（含空回车、粘贴中的换行）都会回调，后端据此清除权威状态门；
 * 首行素材同时参与标题升级，但「是否真的改名」由注册表统一裁决。
 * 放在这里而不是组件体内：组件已贴近规模基线，而这段逻辑与输入解析是同一职责。
 */
export function createUserInputActivityReporter(opts: {
  getSessionId: () => string | null;
  report: (sessionId: string, line: string) => void;
}): (text: string) => void {
  let submitted = false;
  let submittedLine = '';
  const capture = createLineCapture({
    stopAfterFirst: false,
    includeEmpty: true,
    onSubmit: (line) => {
      if (submitted) return;
      submitted = true;
      submittedLine = line;
    },
  });
  return (text: string): void => {
    submitted = false;
    submittedLine = '';
    capture.feed(text);
    if (!submitted) return;
    const sessionId = opts.getSessionId();
    if (sessionId) opts.report(sessionId, submittedLine);
  };
}
