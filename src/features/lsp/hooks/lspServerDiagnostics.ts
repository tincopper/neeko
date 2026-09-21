/**
 * `publishDiagnostics` 的**陈旧坐标护栏**：逐条判定（越界 + 内容锚定）+ 混装批合并。
 *
 * 演进（2026-09-22，四轮裁定）：
 * - **十四轮**：内容锚定 + 语法层过滤（`keepSyntaxLayerOnly`）——语法错误时隐藏全部
 *   语义诊断，语义波浪线"消失"。
 * - **十五轮**：对齐 VS Code（删启发式，整批应用 + 信任服务器重推自愈）——但
 *   rust-analyzer 语义诊断重推慢（flycheck 缓存），陈旧坐标（新版本号+旧坐标）整批
 *   应用把已**跟随正确**的旧波浪线**拽回旧行**。
 * - **十六轮**：恢复内容锚定，**任一条锚定失败 → 整批拒绝**——修复拽回，但**新鲜的
 *   syntax-error 被连带拒绝**（混装批里缺分号波浪线不显示）。
 * - **本轮（18 轮，逐条合并）**：拆分为逐条判定 —— **新鲜的诊断应用，陈旧的诊断用
 *   lint 已跟随位置重建后一并应用**（lint `map(tr.changes)` 编辑时自动跟随，位置正确）。
 *   既不让新鲜 syntax-error 被连带拒绝，也不让陈旧 E0425 用旧坐标覆盖跟随正确的位置。
 *
 * 判定链（每条诊断独立）：
 * - **越界安全网**：坐标形状落不进 `WorkspaceFile.doc`（该 version 对应的文本）→ 陈旧；
 * - **内容锚定**：点名 token 诊断（E0425/E0433 的 `` `int32` ``）映射到当前文本切片，
 *   不含该 token → 坐标与文本不符 → 陈旧（fail-open：无 token / 跨行 / 零长度 /
 *   超宽 / 映射失败一律视为新鲜，不误杀 syntax-error）；
 * - **合并**：陈旧诊断从 lint 层按 message 取跟随位置重建坐标；lint 也没有 → 丢弃
 *   （无旧线可保留，应用旧坐标会画错位）。
 *
 * **版本门**：`params.version != file.version` 的推送由内层 lsp-client 内建丢弃。
 * lint 层 `map(tr.changes)` 文本跟随是 CodeMirror 天然行为，编辑时旧线随文本走。
 */
import { forEachDiagnostic } from '@codemirror/lint';
import {
  LSPPlugin,
  serverDiagnostics,
  type LSPClient,
  type LSPClientExtension,
  type WorkspaceFile,
} from '@codemirror/lsp-client';
import type { Text } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';

interface LspPosition {
  line: number;
  character: number;
}

interface LspRange {
  start: LspPosition;
  end: LspPosition;
}

interface RawDiagnostic {
  range?: LspRange;
  message?: string;
  code?: string | number;
  severity?: number;
  source?: string;
}

interface PublishDiagnosticsParams {
  uri?: string;
  version?: number | null;
  diagnostics?: RawDiagnostic[];
}

/** 位置能否落在该文档上（越界 = 坐标不属于这份文本）。 */
function positionFits(doc: Text, position: LspPosition | undefined): boolean {
  if (!position || typeof position.line !== 'number' || typeof position.character !== 'number') {
    return false;
  }
  if (position.line < 0 || position.line >= doc.lines || position.character < 0) return false;
  return position.character <= doc.line(position.line + 1).length;
}

/** 范围两端都要落得下（跨行范围按各自所在行判断）。 */
export function rangeFitsDocument(doc: Text, range: LspRange | undefined): boolean {
  if (!range) return false;
  return positionFits(doc, range.start) && positionFits(doc, range.end);
}

/** 该 uri 的工作区文件（拿不到返回 `null`，调用方按"无法判定"处理）。 */
function workspaceFile(client: LSPClient, uri: string | undefined): WorkspaceFile | null {
  if (!uri) return null;
  return (client.workspace as { getFile(uri: string): WorkspaceFile | null }).getFile(uri);
}

/**
 * 内容锚定校验（2026-09-22 实证修正，见文件头「为什么不删」）。
 *
 * 为什么需要：rust-analyzer 1.97.1 把「当前版本号盖在旧分析坐标」上重发（两时钟：
 * 文档版本钟 ≠ 分析新鲜钟，flycheck 缓存）——版本门放行、越界检查只挡"坐标形状"，
 * 挡不住"行号合法但内容对不上"。点名 token 的诊断（E0425/E0433 的 message 含
 * `` `int32` `` 这类反引号 token），用与内层**同源**的映射
 * （`fromPosition(range, syncedDoc)` → `unsyncedChanges.mapPos`）落到当前文本，
 * 检查该切片是否含该 token；不含 → 该条必定陈旧，拒绝整批应用（lint/mirror 映射
 * 的旧波浪线仍跟随文本，不被拽回旧行）。
 *
 * fail-open 集合（无法判定一律放行）：无 token、无 range、跨行 range、拿不到该视图
 * 的 LSP 插件、映射抛错、零长度区间、超宽区间（>500 列）。
 */
const ANCHOR_TOKEN_PATTERN = /`([^`]+)`/;

/** 从诊断消息里提取点名的符号；无或形态不符返回 `null`（调用方按“无法判定”放行）。 */
function anchorToken(message: string | undefined): string | null {
  if (!message) return null;
  const token = ANCHOR_TOKEN_PATTERN.exec(message)?.[1]?.trim() ?? '';
  return /^[A-Za-z0-9_:]+$/.test(token) ? token : null;
}

/**
 * 该诊断的坐标是否锚定在当前文本上。
 *
 * fail-open（无法判定一律 `true` 放行，沿用既有三层结论）：无 token、无 range、
 * 跨行 range、拿不到该视图的 LSP 插件、映射抛错、零长度区间（语法点无可锚文本）、
 * 超宽区间（>500 列，服务器 underline 整表达式时无法可靠锚定）。
 */
function anchorFitsCurrentText(view: EditorView, diagnostic: RawDiagnostic): boolean {
  const token = anchorToken(diagnostic.message);
  const range = diagnostic.range;
  if (!token || !range || range.start.line !== range.end.line) return true;
  const plugin = LSPPlugin.get(view);
  if (!plugin) return true;
  let from: number;
  let to: number;
  try {
    from = plugin.unsyncedChanges.mapPos(plugin.fromPosition(range.start, plugin.syncedDoc));
    to = plugin.unsyncedChanges.mapPos(plugin.fromPosition(range.end, plugin.syncedDoc));
  } catch {
    return true;
  }
  if (!(to > from) || to - from > 500) return true;
  // 宽容匹配（`includes` 而非相等）：服务器 range 略宽于 token 时仍能通过。
  return view.state.doc.sliceString(from, to).includes(token);
}

/** lint 已渲染诊断的当前位置（编辑跟随后的坐标）。 */
interface LintPos {
  from: number;
  to: number;
}

/**
 * 读取 lint 层当前已渲染诊断的位置（按 message 去重，首见优先）。
 *
 * 用途（18 轮修正）：混装批里陈旧诊断（如 E0425 旧坐标）在 lint 中已有**跟随正确**
 * 的渲染位置（lint `map(tr.changes)` 编辑时自动跟随）。合并时用该位置重建坐标，
 * 使陈旧诊断保留在正确位置而不被旧坐标拽回。
 */
function lintPositionsByMessage(view: EditorView): Map<string, LintPos> {
  const out = new Map<string, LintPos>();
  forEachDiagnostic(view.state, (d, from, to) => {
    if (!out.has(d.message)) out.set(d.message, { from, to });
  });
  return out;
}

/**
 * 服务器诊断扩展（在 `serverDiagnostics()` 之上加越界 + 内容锚定护栏）。
 *
 * 直接包装其 handler 而不是并列注册：lsp-client 的通知分发是"第一个返回 true 的
 * handler 胜出"，并列注册无法实现"过滤后再委托"。
 *
 * 时序语义：**即时应用，无待定延迟** —— 新鲜推送到达即纠正；陈旧推送由越界 +
 * 内容锚定挡掉，旧波浪线经 lint/mirror 映射跟随文本（不被拽回旧行）。
 */
export function lspServerDiagnostics(): LSPClientExtension {
  const base = serverDiagnostics();
  const inner = base.notificationHandlers?.['textDocument/publishDiagnostics'];

  /** 越界安全网 + 内容锚定，逐条决策 + 合并后委托内层（内层持有版本门）。 */
  function applyFiltered(client: LSPClient, params: PublishDiagnosticsParams): boolean {
    const incoming = params.diagnostics ?? [];

    // 空推送 = 服务器清空该文件诊断：即时应用（整体替换语义）。
    if (incoming.length === 0) {
      return inner ? inner(client, params) : false;
    }

    // 拿不到该版本文本（文件未打开等）→ 交给内层按原语义处理。
    const file = workspaceFile(client, params.uri);
    if (!file?.doc) {
      return inner ? inner(client, params) : false;
    }
    const doc = file.doc;
    const view = file.getView();

    // 逐条新鲜度判定：越界安全网（坐标形状）+ 内容锚定（点名 token 落位）。
    // fail-open：无 token / 跨行 / 零长度 / 超宽等一律视为新鲜（不误杀 syntax-error）。
    const isFresh = (d: RawDiagnostic): boolean =>
      rangeFitsDocument(doc, d.range) && (!view || anchorFitsCurrentText(view, d));

    const fresh = incoming.filter(isFresh);
    const stale = incoming.filter((d) => !isFresh(d));

    // 全部新鲜 → 整批应用（与 VS Code `DiagnosticCollection.set` 同语义）。
    if (stale.length === 0) {
      return inner ? inner(client, params) : false;
    }
    // 全部陈旧 → 整批拒绝（保留 lint/mirror 已跟随旧线，不被拽回旧行）。
    if (fresh.length === 0) {
      if (import.meta.env.DEV) {
        console.info(
          `[LSP-probe] dropped ${incoming.length} stale diagnostic(s) for ${params.uri}; kept previous batch`,
        );
      }
      return true;
    }

    // 混合批（18 轮修正）：新鲜的应用，陈旧的**用 lint 已跟随位置重建**后一并应用 ——
    // 既不让新鲜的 syntax-error 被连带拒绝（缺分号波浪线必须显示），也不让陈旧的 E0425
    // 用旧坐标覆盖 lint 已跟随正确的位置（整批替换语义下不能只应用子集，否则会隐式清除
    // 被过滤的诊断）。
    const plugin = view ? LSPPlugin.get(view) : null;
    const lintPos = view ? lintPositionsByMessage(view) : new Map<string, LintPos>();
    // 陈旧诊断的 lint 位置是**当前视图坐标**，而内层按 `syncedDoc` 解释 range 再经
    // `unsyncedChanges.mapPos` 映射回视图。未同步编辑窗口内（autoSync ~500ms）直接
    // `toPosition`（视图坐标）会对 syncedDoc 造出错位偏移；用 `unsyncedChanges.invert`
    // 把视图偏移反解回 syncedDoc 再转坐标，内层往返恒等（无未同步变化时逆映射恒等，
    // 与直接 `toPosition` 等价）。
    const toSynced = plugin
      ? (() => {
          const inverted = plugin.unsyncedChanges.invert(plugin.syncedDoc);
          return (offset: number) => plugin.toPosition(inverted.mapPos(offset), plugin.syncedDoc);
        })()
      : null;
    const merged: RawDiagnostic[] = [];
    for (const d of incoming) {
      if (isFresh(d)) {
        merged.push(d);
        continue;
      }
      // 陈旧诊断：lint 里若已有同 message 的跟随位置 → 用该位置重建坐标（经内层同源
      // 映射后落在跟随处）；lint 里也没有 / 无 plugin（无旧线可保留）→ 丢弃，避免
      // 旧坐标画错位。
      if (!plugin || !toSynced) continue;
      const pos = lintPos.get(d.message ?? '');
      if (pos) {
        merged.push({
          ...d,
          range: { start: toSynced(pos.from), end: toSynced(pos.to) },
        });
      }
    }
    if (merged.length === 0) {
      return true;
    }
    if (import.meta.env.DEV) {
      console.info(
        `[LSP-probe] merged ${merged.length} diagnostic(s) for ${params.uri} ` +
          `(${fresh.length} fresh + ${merged.length - fresh.length} stale-relocated)`,
      );
    }
    return inner ? inner(client, { ...params, diagnostics: merged }) : false;
  }

  return {
    ...base,
    notificationHandlers: {
      ...base.notificationHandlers,
      'textDocument/publishDiagnostics': (client: LSPClient, rawParams: unknown) => {
        const params = (rawParams ?? {}) as PublishDiagnosticsParams;
        return applyFiltered(client, params);
      },
    },
  };
}
