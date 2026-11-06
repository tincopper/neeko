/**
 * 终端 `onData` 的**用户提交检测**（前端侧）—— 只回答「用户提交了一行吗」，不决定命名。
 *
 * # 终端 I/O 不是标题源（2026-11-06 源隔离）
 *
 * OSC 标题（`onTitleChange`）已从生产者集合里删除：它与状态栏、cwd、spinner、TUI 控件文本
 * 共用通道，`π` / `✳ Claude ready` / `/model` 的过滤词都从那里进来。加黑名单 / 准入判据
 * 挡不住下一种控件输入，所以整条通道断开。
 *
 * 用户输入行**仍然上报**，但它的去向由后端裁决而不是在这里：backend
 * `Registry::report_terminal_input` 按会话登记时的 `agent_id` 决定 —— 纯 shell 用这行命名
 * （它没有 hook / conversation 通道，这是唯一素材），agent 终端一律不用（`onData` 里混着
 * TUI 面板输入，无法与真实请求区分）。
 *
 * 于是这里的职责只有两件：认出「这是一次真实提交」，以及**把行原样交给传输层**；
 * 「配不配当标题」在前端一份都没有。
 *
 * # 为什么检测还在前端
 *
 * `terminal-input-{id}` 同时承载两类写入：
 *
 * 1. **我们自动启动 agent 的那行命令** —— `TerminalViewBase` 创建会话后立即写入
 *    `pi --approve\r`（见 `if (tabAgentId && !taskCommand)` 分支）；
 * 2. 用户在 `term.onData` 里敲的按键。
 *
 * 后端收到的是同一串字节，无从区分；只有前端知道某次写入是不是来自 `onData`。
 * 活动上报只挂在 `sendInput`（= `onData`）路径上，于是自动启动命令不会把会话
 * 误标成「用户已在用」。
 *
 * # `onData` **也不全是用户输入**
 *
 * xterm 会把它**自己**对终端查询的应答从 `onData` 发出去 —— 例如 CLI 查前景色时回
 * `ESC ] 10 ; rgb:3838/3a3a/4242 ST`（OSC 10），查光标位置时回 `ESC [ 12 ; 40 R`（DSR）。
 * 这些字节不是用户提交，混进来会凭空产生一次活动。判据：**协议应答 / 转义序列整块丢弃**。
 * 例外是 bracketed paste：xterm 在 shell 开启该模式后会把用户粘贴内容包在
 * `ESC[200~ … ESC[201~` 里，标记属于传输协议，内容仍来自用户。
 *
 * # 行解析规则（纯检测，不参与命名判据）
 *
 * - bracketed paste 标记剥离后按用户输入处理；
 * - 其余 ESC 序列（CSI / OSC / DCS / 字符集等）整段丢弃，且支持跨 `onData` 分块；
 * - 累积到**回车**才结算（输入按键盘分块到达，一次一个键）；
 * - 退格（`DEL` / `BS`）回删缓冲区最后一个字符，避免把已删内容当结算依据；
 * - 其余控制字符（制表等）不进缓冲区；
 * - 默认行捕获忽略空回车；活动上报把空回车视为一次用户提交（审批界面可能只按 Enter）；
 * - 默认只取第一条非空行；活动上报器关闭该限制，每次提交都回调，且单个数据块最多
 *   回调一次（避免大段粘贴形成 IPC 风暴）。
 */

/** 缓冲区上限：只为防大段粘贴占内存（后端 `title::admit` 再按字符截到 80）。 */
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

/**
 * 默认行捕获器：只结算第一条非空输入行。
 *
 * 无生产调用方，仅作为 ESC / 粘贴解析规则的测试夹具 —— 行文本**不得**流向 IPC。
 */
export function createFirstLineCapture(): InputLineCapture {
  return createLineCapture();
}

/**
 * 「用户提交输入 → 上报活动」的包装：内部持有捕获器，返回可直接用作 `sendInput`
 * 副作用的函数。
 *
 * 每次非协议输入（含空回车、粘贴中的换行）都算一次提交，后端据此置 `has_user_input`
 * 并清除权威状态门。回调同时带上**行文本**：纯 shell 没有 hook / conversation 通道，
 * 这行就是它唯一的标题素材；有 agent 的终端由**后端**按 `agent_id` 判负（不采用），
 * 前端不做第二套判据。
 *
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
