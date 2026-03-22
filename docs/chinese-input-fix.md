# Linux 中文输入问题修复文档

## 问题描述

在 Linux 环境下，xterm.js 终端输入中文字符时会出现重复显示的问题。具体表现为：
- 输入一个中文字符（如"你"），终端会重复显示之前输入过的所有中文字符
- 输入法组合期间的中间文本也会被发送到 PTY，导致累积输出

## 问题根因

### 1. xterm.js 的 IME 处理时序问题

xterm.js 的 `onData` 回调和浏览器的 composition 事件存在时序问题：

```
用户输入拼音 → keydown(229) → compositionstart → compositionupdate → compositionend
                                    ↓                    ↓                 ↓
                              xterm.js 的 textarea 开始累积输入，可能在任意时刻发送
```

在 Linux 环境下，`compositionstart` 事件触发时，`keydown` 事件（keyCode 229）可能已经触发了 xterm.js 的输入处理，导致：
- IME 组合期间的中间文本被发送
- 多个字符被累积后一次性发送

### 2. PTY 回显机制

传统 PTY 模式下，终端会回显用户输入的字符。当前端也手动显示输入时，会导致重复显示。

## 解决方案

### 方案一：禁用 PTY 回显 + 前端手动显示（推荐）

**原理**：在 Rust 端禁用 PTY 的回显功能，完全由前端控制输入的显示。

#### 1. Rust 端禁用回显

```rust
// src-tauri/src/terminal.rs

#[cfg(not(target_os = "windows"))]
fn disable_echo(fd: std::os::fd::RawFd) -> Result<()> {
    use std::mem::MaybeUninit;

    let mut termios = MaybeUninit::<libc::termios>::uninit();

    // 获取当前终端属性
    if unsafe { libc::tcgetattr(fd, termios.as_mut_ptr()) } != 0 {
        return Err(anyhow::anyhow!("Failed to get terminal attributes"));
    }

    let mut termios = unsafe { termios.assume_init() };

    // 禁用 ECHO 和 ECHONL (本地字符回显和换行符回显)
    termios.c_lflag &= !(libc::ECHO | libc::ECHOE | libc::ECHOK | libc::ECHONL);

    // 禁用 ICANON (规范模式)，使输入立即可用
    termios.c_lflag &= !libc::ICANON;

    // 设置最小读取字符和超时
    termios.c_cc[libc::VMIN] = 1;
    termios.c_cc[libc::VTIME] = 0;

    // 应用设置
    if unsafe { libc::tcsetattr(fd, libc::TCSANOW, &termios) } != 0 {
        return Err(anyhow::anyhow!("Failed to set terminal attributes"));
    }

    Ok(())
}

// 在 PTY 创建后调用
let master_fd = pair.master.as_raw_fd();
if let Some(fd) = master_fd {
    if let Err(e) = disable_echo(fd) {
        log_error(&format!("[PTY] Failed to disable echo: {}", e));
    }
}
```

**依赖**：在 `Cargo.toml` 中添加 `libc = "0.2"`

#### 2. 前端处理

```tsx
// src/components/TerminalView.tsx

// 设置 UTF-8 环境
cmd.env("LANG", "en_US.UTF-8");
cmd.env("LC_ALL", "en_US.UTF-8");
cmd.env("LC_CTYPE", "en_US.UTF-8");

// IME composition 处理
let isComposing = false;
let compositionPendingText = "";

const sendInput = (text: string) => {
  // 手动显示输入（因为 PTY 回显已禁用）
  term.write(text);
  // 发送到 PTY
  const bytes = Array.from(new TextEncoder().encode(text));
  emit(`terminal-input-${sid}`, bytes);
};

// 设置 IME 处理
const textarea = element.querySelector('.xterm-helper-textarea');
if (!textarea) return;

// keyCode 229 是 IME composition 的标志，在 compositionstart 之前就会触发
textarea.addEventListener('keydown', (e: KeyboardEvent) => {
  if (e.keyCode === 229 && !isComposing) {
    isComposing = true;
    compositionPendingText = "";
  }
});

textarea.addEventListener('compositionstart', () => {
  isComposing = true;
  compositionPendingText = "";
});

textarea.addEventListener('compositionend', (e) => {
  const committed = e.data || "";
  if (committed) {
    compositionPendingText = committed;
    sendInput(committed);
    setTimeout(() => {
      isComposing = false;
      compositionPendingText = "";
    }, 50);
  } else {
    isComposing = false;
  }
});

term.onData((data) => {
  if (isComposing) return;
  if (data === compositionPendingText) {
    compositionPendingText = "";
    return;
  }
  sendInput(data);
});
```

### 方案二：渲染优化（可选）

安装 xterm.js 的渲染插件提升视觉效果：

```bash
npm install xterm-addon-webgl xterm-addon-unicode11
```

```tsx
// 前端加载插件
import { WebglAddon } from "xterm-addon-webgl";
import { Unicode11Addon } from "xterm-addon-unicode11";

// 加载 Unicode11 支持，解决中文宽度计算问题
const unicodeAddon = new Unicode11Addon();
term.loadAddon(unicodeAddon);
term.unicode.activeVersion = "11";

// 加载 WebGL 渲染器，提升渲染质量
try {
  const webglAddon = new WebglAddon();
  webglAddon.onContextLoss(() => webglAddon.dispose());
  term.loadAddon(webglAddon);
} catch (e) {
  console.log("WebGL addon not available");
}
```

## 技术细节

### keyCode 229 详解

#### 什么是 keyCode 229？

`keyCode 229` 不是某个具体的物理键，而是一个**虚拟事件码**。

在浏览器中，当 IME（输入法）正在工作时，浏览器会发送 keyCode = 229 的 keydown 事件，表示：

> "输入法正在处理用户的击键，请忽略这些 keydown 事件，等组合完成后再处理"

#### 触发时序

```
用户按下键盘上的键
      ↓
浏览器生成 keydown 事件（keyCode = 229）
      ↓
输入法内部处理组合
      ↓
用户确认组合结果（按空格/回车）
      ↓
compositionend 事件触发
      ↓
浏览器生成最终的 input 事件
```

#### keyCode 值对照

| keyCode | 含义 |
|---------|------|
| 229 | 输入法正在工作（组合中），应该忽略 |
| 其他值 | 普通按键事件，可以立即处理 |

#### 使用场景

```javascript
textarea.addEventListener('keydown', (e) => {
  if (e.keyCode === 229) {
    // 这是一个 IME 组合事件
    // 不应该立即处理，应该等待 compositionend
    return;
  }
  // 这是普通按键事件，可以立即处理
  handleNormalKey(e);
});
```

#### 为什么这个方案有效？

Linux 下的问题是：`keydown(229)` 先于 `compositionstart` 事件触发。如果在 `keydown(229)` 时没有立即设置 `isComposing = true`，xterm.js 的输入处理就会在 `compositionstart` 之前被触发，导致累积的输入被发送。

解决方案是在 `keydown(229)` 时立即设置 `isComposing = true`，确保：
1. 在 `compositionstart` 之前就阻止 xterm.js 发送数据
2. 只有在 `compositionend` 后才发送最终的组合结果

### PTY 回显禁用的原理

Linux 终端驱动有两层回显：
1. **本地回显**：终端本身在接收到字符时显示
2. **远程回显**：程序读取字符后原样返回给终端

通过设置 `termios.c_lflag` 中的 `ECHO` 标志，可以禁用本地回显。禁用 `ICANON` 可以让终端以原始模式运行，每个按键立即发送到程序。

## 测试验证

运行应用后，可以通过以下方式验证修复效果：

1. 输入中文字符，观察终端是否只显示一次
2. 检查浏览器控制台是否没有重复的输入日志
3. 测试英文字符输入是否正常
4. 测试命令执行（回车）是否正常

## 相关问题

### Q: 禁用回显会影响命令执行吗？

A: 不会。命令执行后的输出仍然由 PTY 正常回显（通过 reader 线程），只影响用户输入的即时显示。

### Q: Windows 上是否需要特殊处理？

A: 目前 Windows 版本不需要禁用回显，因为 IME 处理机制不同。代码中使用了 `#[cfg(target_os = "windows")]` 来跳过 Linux 特有的处理。

### Q: 如何调试输入问题？

A: 可以在 `sendInput` 函数和 Rust 端的 PTY-WRITER 监听中添加日志，观察数据流向：

```tsx
console.log(`sendInput: "${text}", isComposing: ${isComposing}`);
```

```rust
log_info(&format!("[PTY-WRITER] Received: {:?}", data));
```

## 参考资料

- [xterm.js IME Handling](https://xtermjs.org/docs/api/terminal/interfaces/iterminaloptions/)
- [Linux termios Manual](https://man7.org/linux/man-pages/man3/termios.3.html)
- [portable-pty Documentation](https://docs.rs/portable-pty/)
