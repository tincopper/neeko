// Neeko 状态上报 shim（stdin 形态）。由 Neeko 安装，请勿原地编辑。
//
// 为什么存在（父任务 design T8）：Claude / CodeBuddy / Qoder 支持 `{"type":"http"}` hook，
// 但 URL 是**静态字符串**，无法表达「N 个活实例的随机端口」（`10-12` v5 多实例契约 R6.8）——
// 静态配置与动态坐标不可调和。故一律走 `command` hook + 本 shim：shim 是**稳定路径**
// （配置里写死它），坐标发现发生在**运行时**（每次上报重扫目录）。
//
// 契约（与 Rust 侧同源，改一端必须同步另一端）：
//   argv:  <source> <event_key> [<json>]  —— 语义键由 argv 传入，本文件零 per-CLI 事件名知识
//   stdin: CLI 的 hook input JSON（Claude Code 规范；Codex 字段名同形）
//   env:   NEEKO_AGENT_HOOK_ENDPOINT / NEEKO_AGENT_HOOK_ENDPOINTS_DIR 覆盖（调试/夹具）
//   出站:  POST http://127.0.0.1:{port}/hook/{source}   header: x-neeko-agent-hook-token
//
// **载荷来源双相**（两种 CLI 的投递形态不同，同一个 shim 必须都支持）：
//   - Claude 兼容面（claude / codebuddy / qoder）：JSON 走 **stdin**（argv 只有两项）；
//   - Codex `notify`：JSON 走 **argv[3]**（`notify = [node, shim, source, event_key]`
//     加不上 JSON —— 实测 Codex 把载荷追加为**最后一个参数**，见 research/codex-trust-spike.md）。
//   `source` / `event_key` 两路取法完全一致 ⇒ 零 per-CLI 知识不变。
//
// 硬约束（design T5 / R6.2）：800ms 超时、一切异常吞掉、**永远 exit 0**
// （exit≠0 会被 CLI 当作阻断/失败，违反「绝不阻塞用户终端里的 agent」）。
import { readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const REPORT_TIMEOUT_MS = 800;
// 单文件覆盖（调试/测试夹具）：设置后只读该文件，不扫目录。
const ENDPOINT_FILE = process.env.NEEKO_AGENT_HOOK_ENDPOINT || null;
// v5 多实例：每实例一个坐标文件，上报前扫全部并逐个投递。
const ENDPOINTS_DIR =
  process.env.NEEKO_AGENT_HOOK_ENDPOINTS_DIR ||
  join(homedir(), ".neeko", "agent-hooks", "endpoints");

// argv: [node, shim, source, event_key, payload?]
const [, , source, eventKey, argvPayload] = process.argv;

function parseCoords(text) {
  const get = (name) => {
    const m = text.match(new RegExp("^" + name + "=(.+)$", "m"));
    return m ? m[1].trim() : undefined;
  };
  const port = get("NEEKO_AGENT_HOOK_PORT");
  const token = get("NEEKO_AGENT_HOOK_TOKEN");
  return port && token ? { port, token } : null;
}

// 坐标发现：**不缓存** —— 本进程是短命进程（每次 hook 事件一个新进程），
// 缓存没有跨调用收益，反而引入「读到旧坐标」的风险（与常驻的 pi/opencode 扩展不同）。
function coords() {
  if (ENDPOINT_FILE) {
    try {
      const c = parseCoords(readFileSync(ENDPOINT_FILE, "utf8"));
      return c ? [c] : [];
    } catch {
      return [];
    }
  }
  try {
    const out = [];
    for (const name of readdirSync(ENDPOINTS_DIR)) {
      if (!name.endsWith(".env")) continue;
      try {
        const c = parseCoords(readFileSync(join(ENDPOINTS_DIR, name), "utf8"));
        if (c) out.push(c);
      } catch {
        // 单坐标不可读 → 跳过，不影响其余（fail-open）
      }
    }
    return out;
  } catch {
    return []; // Neeko 未运行 / 目录不存在 → 静默
  }
}

function readStdin() {
  try {
    return readFileSync(0, "utf8"); // fd 0 = stdin，同步读（短命进程，无需流式）
  } catch {
    return "";
  }
}

// 载荷来源双相：**先试 argv，再回退 stdin**。
//
// 顺序不可交换：Claude 面的 hook 也会给 shim 传 argv（但只有 source/event_key 两项），
// 故 argv[4] 在 Claude 面恒为 undefined → 自然落到 stdin；Codex 面的 stdin 可能是
// TTY / 已关闭，读它会阻塞或返回空。先 argv 是两路都安全的顺序。
function readPayload() {
  const fromArgv =
    typeof argvPayload === "string" && argvPayload.trim().startsWith("{") ? argvPayload : null;
  return fromArgv !== null ? fromArgv : readStdin();
}

// 首个非空行并 trim（副标题是单行展示位）。
function firstLine(text) {
  if (typeof text !== "string") return null;
  const line = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  return line ? line.slice(0, 200) : null;
}

// 取字段：支持多个候选名（**同一语义在不同 CLI 里拼法不同**）。
//
// 为什么需要这个：父任务 design T9 曾断言「字段名收敛，一个提取函数覆盖四家」——
// 该断言只对 **hook 面**成立（Claude 规范 / CodeBuddy / Qoder 都是 snake_case）。
// Codex 的 `notify` 面**不同**：它的载荷是 **kebab-case**（`thread-id` / `input-messages` /
// `last-assistant-message`），实测见 `research/codex-trust-spike.md`。
// 故提取改成「按语义列候选名」，新 CLI 只需往对应链上添一个名字（差异落数据）。
function pick(input, names) {
  for (const name of names) {
    const v = input[name];
    if (typeof v === "string" && v) return v;
  }
  return null;
}

// 主题候选：**数据表**（读法 → 来源），按优先级排列。
//
// 来源只有两类观测，判据靠它定覆盖序（`Prompt < Native`）：
//   native — CLI 自己写的会话名（claude / qoder 的 `session_title`、codex 的 `thread_name`）
//   prompt — 用户敲的字（claude 兼容面的 `prompt`、codex notify 的 `input-messages[0]`）
// 字段名差异落在这张表里，下面的函数不认识任何 CLI 名。
const TOPIC_SOURCES = [
  { source: "native", read: (input) => firstLine(input.session_title) },
  { source: "native", read: (input) => firstLine(input.thread_name) },
  { source: "prompt", read: (input) => firstLine(input.prompt) },
  {
    source: "prompt",
    read: (input) =>
      firstLine(Array.isArray(input["input-messages"]) ? input["input-messages"][0] : null),
  },
];

// 第一个取到文本的候选。**来源必须随文本一起上报**：同一句「Can you please …」当
// CLI 自述用时是主题，当用户 prompt 用时前端会剥掉客套包装 —— 服务端猜不出来。
function pickTopic(input) {
  for (const candidate of TOPIC_SOURCES) {
    const title = candidate.read(input);
    if (title) return { title, source: candidate.source };
  }
  return { title: null, source: null };
}

// CLI hook input → Neeko envelope。
//
// 候选名链覆盖两种面：
//   hook 面（claude / codebuddy / qoder / codex 的 hooks.json）：`session_id` / `turn_id`
//   notify 面（codex）：`thread-id` / `turn-id`
function toEnvelope(input) {
  const detail =
    pick(input, ["tool_name", "message", "title", "last-assistant-message"]) || null;
  // 会话主题（R7）：优先原生标题；无则取首条用户消息（notify 面叫 `input-messages`）。
  const topic = pickTopic(input);
  return {
    agent_session_id:
      pick(input, ["session_id", "turn_id", "thread-id", "turn-id", "thread_id"]) || "",
    event: eventKey,
    // hook 进程的 cwd 即用户启动 CLI 的目录（归属链第 2/3 级原料）。
    cwd: pick(input, ["cwd"]) || process.cwd(),
    detail: detail ? String(detail).slice(0, 500) : null,
    // 会话主题（R7）：服务端只做非空校验 + 截断，优先级判定已在本函数完成。
    title: topic.title,
    // 主题来源（判据的输入，不是展示字段）：`native` = CLI 自述，`prompt` = 用户敲的字。
    title_source: topic.source,
    hints: {
      neeko_session_id: process.env.NEEKO_SESSION_ID || null,
      project_id: process.env.NEEKO_PROJECT_ID || null,
    },
  };
}

async function main() {
  if (!source || !eventKey) return; // 参数缺失 → 静默
  const list = coords();
  if (!list.length) return;

  let input = {};
  try {
    const raw = readPayload();
    input = raw ? JSON.parse(raw) : {};
  } catch {
    input = {}; // 非法 JSON → 空对象（cwd 走 process.cwd() 兜底，仍可归属）
  }
  const envelope = toEnvelope(input);
  if (!envelope.agent_session_id) return; // 无会话身份 → 静默（server 侧也会吞）

  const body = JSON.stringify(envelope);
  // fan-out：每个坐标一次 POST，逐个 fail-open（单坐标失败不影响其余，也不影响 CLI）。
  await Promise.allSettled(
    list.map(async (c) => {
      try {
        await fetch(`http://127.0.0.1:${c.port}/hook/${source}`, {
          method: "POST",
          signal: AbortSignal.timeout(REPORT_TIMEOUT_MS),
          headers: {
            "content-type": "application/json",
            "x-neeko-agent-hook-token": c.token,
          },
          body,
        });
      } catch {
        // fail-open：静默（死坐标/超时/被拒一律跳过）。
      }
    }),
  );
}

// 顶层兜底：任何未捕获异常都不得改变退出码（design T5）。
main()
  .catch(() => {})
  .finally(() => process.exit(0));
