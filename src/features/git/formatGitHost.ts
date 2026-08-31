/**
 * 从 git remote URL 中提取可读的 hostname（仅显示域名部分）。
 * 支持 ssh（git@host:repo）与 https（https://[user@]host/repo）两种形态。
 */
export function formatGitHost(url: string): string {
  try {
    const cleaned = url.replace(/^git@/, '').replace(/\.git$/, '');
    if (cleaned.includes('://')) {
      const afterProtocol = cleaned.split('://')[1];
      const withoutUser = afterProtocol.includes('@') ? afterProtocol.split('@')[1] : afterProtocol;
      return withoutUser;
    }
    if (cleaned.includes(':')) {
      return cleaned.split(':')[0];
    }
    return cleaned;
  } catch {
    return url;
  }
}
