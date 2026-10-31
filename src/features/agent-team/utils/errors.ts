/**
 * 把 `invoke` 的拒绝原因压成**可读原文**。
 *
 * 团队的失败几乎都是「用户需要读到原因」的那一类（准入拒绝 / 起不来的 CLI / 团队不在了），
 * 所以这里不做任何归因或改写：后端 `AppError` 的 `Display` 已经是给人看的句子
 * （`Unsupported: …` / `Not found: …`）。前端自己编一句「操作失败」会把唯一有用的信息丢掉。
 *
 * 为什么不用 `@/features/git/utils/prLoadError` 里同名函数：那是 git 域的私有实现，
 * 跨 feature 直导内部工具会把它变成事实上的公共 API（导入防火墙只认 `store/` `types/` `api/`）。
 */
export function messageOf(err: unknown, fallback: string): string {
  if (typeof err === 'string' && err.trim() !== '') return err.trim();
  if (err instanceof Error && err.message.trim() !== '') return err.message.trim();
  if (err != null) {
    const text = String(err);
    if (text !== '' && text !== '[object Object]') return text;
  }
  return fallback;
}
