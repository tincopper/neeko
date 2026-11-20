/**
 * 行内改名的**提交判据**（列表行与面板头共用一份）。
 *
 * 两处入口各写一次 `if (next === '') return;` 看起来只有三行，但它是**判据**而不是排版：
 * 空名在后端是 `InvalidInput`（列表会出现一个点不中的空行），没改就重写一遍只是白写一条
 * 审计。两份拷贝里只改一处，症状是「一个入口点两次会写两条审计、另一个不会」。
 *
 * @returns 要提交的名字（已裁掉两端空白）；`null` = **不要发请求**。
 */
export function renameDraftCommit(next: string, current: string): string | null {
  const trimmed = next.trim();
  // 空名不是名字（后端也拒）；去掉空白后与当前名字相同 = 用户没改。
  if (trimmed === '' || trimmed === current) return null;
  return trimmed;
}
