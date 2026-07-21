/**
 * Extract a short description from SKILL.md (or similar) markdown content.
 * Mirrors backend skill_metadata parsing for frontend lazy-fill.
 */
export function parseSkillDescription(content: string): string | null {
  if (!content?.trim()) return null;

  const text = content.replace(/^\uFEFF/, '');
  let body = text;
  let frontDesc: string | null = null;

  const fm = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (fm) {
    const yaml = fm[1];
    body = text.slice(fm[0].length);

    // Single-line description: "foo" or plain
    const single = yaml.match(/^description:\s*(.+)$/m);
    if (single) {
      const v = single[1].trim();
      if (v && v !== '|' && v !== '>' && v !== '|-' && v !== '>-') {
        frontDesc = v.replace(/^["']|["']$/g, '').trim();
      } else {
        // Multi-line block scalar: collect indented lines after description:
        const lines = yaml.split(/\r?\n/);
        let collecting = false;
        const buf: string[] = [];
        for (const line of lines) {
          if (/^description:\s*([|>][-+]?|)\s*$/.test(line) || /^description:\s*$/.test(line)) {
            collecting = true;
            continue;
          }
          if (collecting) {
            if (/^\s+/.test(line) || line.trim() === '') {
              if (line.trim()) buf.push(line.trim());
            } else {
              break;
            }
          }
        }
        if (buf.length) frontDesc = buf.join(' ');
      }
    }
  }

  if (frontDesc?.trim()) {
    return collapse(frontDesc);
  }

  // Body fallback: first non-heading paragraph, else first heading
  let heading: string | null = null;
  let para = '';
  for (const line of body.split(/\r?\n/)) {
    const t = line.trim();
    if (!t) {
      if (para) break;
      continue;
    }
    if (t.startsWith('```') || t.startsWith('<!--')) continue;
    if (t.startsWith('#')) {
      if (!heading) {
        const h = t.replace(/^#+\s*/, '').trim();
        if (h) heading = h;
      }
      if (para) break;
      continue;
    }
    para = para ? `${para} ${t}` : t;
    if (para.length > 280) break;
  }

  const raw = para.trim() || heading || '';
  return raw ? collapse(raw) : null;
}

function collapse(s: string): string {
  const c = s.split(/\s+/).join(' ').trim();
  if (c.length <= 280) return c;
  return `${c.slice(0, 277)}…`;
}

/** Humanize skill_id / kebab name for marketplace cards without API description. */
export function humanizeSkillId(id: string): string {
  return id
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, c => c.toUpperCase());
}
