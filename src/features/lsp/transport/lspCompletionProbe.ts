/**
 * 自动导包 / 文档同步 DEV 探针（纯函数，无副作用）。
 *
 * 从 `tauriLspTransport.ts` 抽出（F7b）：transport 只留订阅 / 转发 / 生命周期，
 * 摘要与有界集合不变量住这里，单测随文件搬（`__tests__/lspCompletionProbe.test.ts`）。
 * 探针绝不能炸掉补全链路 —— 异常载荷一律退化为空摘要。
 */

/** 自动导包探针的样本项（最多取 `MAX_SAMPLES` 条）。 */
interface CompletionDiagnosticSample {
  label: string;
  /** `additionalTextEdits` 条数（>0 即"该补全自带 import 编辑"）。 */
  edits: number;
  insertTextFormat: number | undefined;
}

/** 需要 import 的候选（`label` + 模块路径）—— 自动导包探针的关键判据。 */
interface ImportCandidateSample {
  label: string;
  /** 模块路径（r-a 放在 `labelDetails.detail`；未声明 labelDetailsSupport 时降级到 `detail`）。 */
  modulePath: string;
  /** 该项自带的附加编辑数：>0 = 接受补全即自动落 import。 */
  edits: number;
  hasData: boolean;
}

/** 自动导包探针的响应摘要。 */
export interface CompletionDiagnostics {
  total: number;
  /** 带 `additionalTextEdits` 的项数 —— 0 表示**服务端**没给 import 编辑。 */
  withAdditionalEdits: number;
  /**
   * 需要 import 的候选（最多 [`MAX_SAMPLES`] 条）。
   *
   * 存在的理由：`withAdditionalEdits=0` 有两种截然不同的含义 —— ① 列表里**没有**
   * 需要导包的符号（例如该类型在本文件已导入，或前缀没匹配到）②有候选但服务器把编辑
   * 藏起来了（jdtls 式 resolve 延迟）。只看 0 无法区分，会让排查误判方向。
   */
  importCandidates: ImportCandidateSample[];
  samples: CompletionDiagnosticSample[];
}

/**
 * 文档同步探针（仅 DEV）：把「发给服务器的文档生命周期」摊平成一行。
 *
 * 判据用途：补全列表**不随前缀收敛**（例如前缀 1..6 个字符恒为同一份 167 项、
 * 第 7 个字符突然 0 项）是"服务器手里的文本停在 didOpen 那一刻"的典型症状 ——
 * 前缀恒空 + 位置越界即空列表。此探针与补全请求探针的 uri 对照即可定位同步断点。
 */
export function summarizeLifecycleMessage(message: string): string | null {
  let parsed: {
    method?: string;
    params?: {
      textDocument?: { uri?: string; version?: number; text?: string };
      contentChanges?: { text?: string; range?: unknown }[];
    };
  };
  try {
    parsed = JSON.parse(message);
  } catch {
    return null;
  }
  const method = parsed.method ?? '';
  if (!method.startsWith('textDocument/did')) return null;
  const uri = parsed.params?.textDocument?.uri ?? '?';
  const name = uri.split('/').pop() ?? uri;
  const changes = parsed.params?.contentChanges ?? [];
  const text = parsed.params?.textDocument?.text;
  const detail = changes.length
    ? `changes=${changes.length} full=${changes.some((c) => !c.range)} len=${changes
        .map((c) => c.text?.length ?? -1)
        .join(',')}`
    : text != null
      ? `open-len=${text.length}`
      : 'no-payload';
  return `${method} ${name} v=${parsed.params?.textDocument?.version ?? '-'} ${detail}`;
}

/** 从补全请求里取「目标 uri 尾段 + 位置」：与生命周期探针的 uri 必须一致。 */
export function summarizeCompletionRequest(message: string): string | null {
  let parsed: {
    id?: unknown;
    params?: { textDocument?: { uri?: string }; position?: { line: number; character: number } };
  };
  try {
    parsed = JSON.parse(message);
  } catch {
    return null;
  }
  if (parsed.id == null) return null;
  const uri = parsed.params?.textDocument?.uri ?? '?';
  const pos = parsed.params?.position;
  return `id=${String(parsed.id)} ${uri.split('/').pop() ?? uri} @${pos?.line}:${pos?.character}`;
}

/** 路径关键字不是导包候选（r-a 的 `self::` / `crate::` / `super::` 补全项）。 */
const PATH_KEYWORDS = new Set(['self::', 'crate::', 'super::', 'Self::', 'macro_rules!']);

/**
 * 从候选里提取「模块路径」：`labelDetails.detail` 优先，其次 `detail`。
 * `detail` 里的函数签名（`fn(…)`）等不含 `::`，天然被下面的过滤排除。
 */
function modulePathOf(item: Record<string, unknown>): string | null {
  const labelDetails = item.labelDetails as { detail?: unknown; description?: unknown } | undefined;
  for (const raw of [labelDetails?.detail, labelDetails?.description, item.detail]) {
    const text = typeof raw === 'string' ? raw : '';
    if (text.includes('::')) return text;
  }
  return null;
}

const MAX_SAMPLES = 3;

/**
 * DEV 探针保留的在途 completion id 上限。
 *
 * 未回包/被 cancelRequest 的请求不会走响应分支，id 若只增不删就会在长开发会话里
 * 无界增长（常驻应用的内存卫生）。超过上限时淘汰**最旧**的一条（Set 保持插入序），
 * 保证最新请求仍可被摘要。
 */
const MAX_PENDING_COMPLETION_IDS = 64;

/**
 * 登记一个在途 completion id，并保持集合有界（超限淘汰**最旧**，Set 保持插入序）。
 *
 * 抽成纯函数：`Set` 的"只增不删"是常驻应用的内存卫生隐患，而它的不变量（有界 +
 * 保新）只能通过对集合本身断言来钉住，走 `send()` 无法构造（响应只可能来自已登记的
 * 请求，再发一次就会重新登记）。
 */
export function rememberPendingCompletionId(
  pending: Set<string | number>,
  id: string | number,
  max = MAX_PENDING_COMPLETION_IDS,
): void {
  if (pending.size >= max) {
    const oldest = pending.values().next().value;
    if (oldest !== undefined) pending.delete(oldest);
  }
  pending.add(id);
}

/**
 * 从 `textDocument/completion` 响应里抽出「是否携带 additionalTextEdits」的事实。
 *
 * 存在的理由：「接受补全后 import 不落」有两个互斥的分叉——服务器没给附加编辑，
 * 或客户端应用层丢掉了。此摘要把两分叉变成日志里的一行数字（配合
 * `lspCompletionInfoRenderer` 的结果探针）。响应可能是数组或 `{items}`；
 * 任何异常载荷一律退化为空摘要——**探针绝不能炸掉补全链路**。
 */
export function summarizeCompletionDiagnostics(result: unknown): CompletionDiagnostics {
  const raw = Array.isArray(result)
    ? result
    : result && typeof result === 'object' && Array.isArray((result as { items?: unknown }).items)
      ? (result as { items: unknown[] }).items
      : [];

  const items = raw.filter((i): i is Record<string, unknown> => !!i && typeof i === 'object');
  const withEdits = items.filter(
    (i) => Array.isArray(i.additionalTextEdits) && i.additionalTextEdits.length > 0,
  );

  const importCandidates = items
    .filter((i) => !PATH_KEYWORDS.has(String(i.label ?? '')))
    .flatMap((i) => {
      const modulePath = modulePathOf(i);
      if (!modulePath) return [];
      return [
        {
          label: typeof i.label === 'string' ? i.label : '(no label)',
          modulePath,
          edits: Array.isArray(i.additionalTextEdits) ? i.additionalTextEdits.length : 0,
          hasData: i.data != null,
        },
      ];
    })
    .slice(0, MAX_SAMPLES);

  return {
    total: items.length,
    withAdditionalEdits: withEdits.length,
    importCandidates,
    samples: withEdits.slice(0, MAX_SAMPLES).map((i) => ({
      label: typeof i.label === 'string' ? i.label : '(no label)',
      edits: (i.additionalTextEdits as unknown[]).length,
      insertTextFormat: typeof i.insertTextFormat === 'number' ? i.insertTextFormat : undefined,
    })),
  };
}
