/** Extract a human-readable message from a Tauri invoke rejection. */
export function getInvokeErrorMessage(err: unknown, fallback: string): string {
  if (typeof err === 'string' && err.trim()) return err.trim();
  if (err instanceof Error && err.message.trim()) return err.message.trim();
  if (err != null) {
    const s = String(err);
    if (s && s !== '[object Object]') return s;
  }
  return fallback;
}

/**
 * Best-effort cleanup for older backend errors that dump stderr as a byte array, e.g.
 * `Unknown error: Command failed with code 1: stdout=[], stderr=[71, 114, ...]`
 */
export function cleanRawCommandError(message: string): string {
  const stripped = message
    .replace(/^Unknown error:\s*/i, '')
    .replace(/^Git error:\s*/i, '')
    .trim();

  const byteArrayMatch = stripped.match(/stderr=\[([0-9,\s]+)\]/);
  if (byteArrayMatch) {
    const bytes = byteArrayMatch[1]
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean)
      .map((n) => Number(n));
    if (bytes.length > 0 && bytes.every((n) => Number.isInteger(n) && n >= 0 && n <= 255)) {
      try {
        const decoded = new TextDecoder().decode(Uint8Array.from(bytes)).trim();
        if (decoded) return decoded;
      } catch {
        // fall through
      }
    }
  }

  // Prefer "Command failed with code N: <detail>" detail portion when present
  const cmdMatch = stripped.match(/^Command failed with code \d+:\s*(.+)$/s);
  if (cmdMatch?.[1]) return cmdMatch[1].trim();

  return stripped;
}

export type PrLoadErrorAction = 'retry' | 'auth' | 'none';

export type PrLoadErrorView = {
  title: string;
  detail: string;
  hint?: string;
  action: PrLoadErrorAction;
};

function includesAny(text: string, needles: string[]): boolean {
  const lower = text.toLowerCase();
  return needles.some((n) => lower.includes(n.toLowerCase()));
}

/** Map a raw invoke error string into a friendly PR list empty-state model. */
export function mapPrLoadError(raw: string): PrLoadErrorView {
  const cleaned = cleanRawCommandError(raw);
  const source = `${raw}\n${cleaned}`;

  if (
    includesAny(source, [
      'Could not resolve to a Repository',
      "was not found or you don't have access",
      "don't have access",
      'denied access to this repository',
      'Resource not accessible',
      'insufficient scope',
      'insufficient_scope',
    ])
  ) {
    const repoMatch =
      cleaned.match(/Repository '([^']+)'/i) ||
      cleaned.match(/with the name '([^']+)'/i);
    const repo = repoMatch?.[1];
    return {
      title: "Can't access this repository",
      detail: repo
        ? `Repository '${repo}' was not found or you don't have access.`
        : cleaned ||
          'Repository was not found or you don\'t have access.',
      hint: 'Check the git remote URL and that your GitHub account has permission (private repos need the correct token scopes).',
      action: 'retry',
    };
  }

  if (
    includesAny(source, [
      'authentication failed',
      'gh auth login',
      'Bad credentials',
      'HTTP 401',
      '401 Unauthorized',
    ])
  ) {
    return {
      title: 'GitHub authentication required',
      detail: cleaned || 'GitHub authentication failed.',
      hint: 'Run `gh auth login` or refresh your token, then retry.',
      action: 'auth',
    };
  }

  if (
    includesAny(source, [
      'Network error while contacting GitHub',
      'Could not resolve host',
      'connection timed out',
      'connection refused',
      'network is unreachable',
    ])
  ) {
    return {
      title: "Couldn't reach GitHub",
      detail: cleaned || 'Network error while contacting GitHub.',
      hint: 'Check your connection and try again.',
      action: 'retry',
    };
  }

  return {
    title: 'Failed to load pull requests',
    detail: cleaned || 'An unexpected error occurred.',
    action: 'retry',
  };
}
