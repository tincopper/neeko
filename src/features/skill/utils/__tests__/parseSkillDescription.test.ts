import { describe, it, expect } from 'vitest';
import {
  parseSkillDescription,
  humanizeSkillId,
} from '../parseSkillDescription';

describe('parseSkillDescription', () => {
  it('reads single-line frontmatter description', () => {
    const md = `---
name: my-skill
description: A great skill for testing
---
# Body
`;
    expect(parseSkillDescription(md)).toBe('A great skill for testing');
  });

  it('reads multi-line frontmatter description', () => {
    const md = `---
name: multi
description: |
  Line one of the skill.
  Line two continues.
---
# Body
`;
    const d = parseSkillDescription(md);
    expect(d).toContain('Line one');
    expect(d).toContain('Line two');
  });

  it('falls back to first paragraph', () => {
    const md = `# Code Review

Reviews pull requests for style and correctness.

## Steps
`;
    expect(parseSkillDescription(md)).toBe(
      'Reviews pull requests for style and correctness.',
    );
  });

  it('falls back to heading when no paragraph', () => {
    expect(parseSkillDescription('# Only Title\n\n## Section\n')).toBe('Only Title');
  });
});

describe('humanizeSkillId', () => {
  it('converts kebab-case to title words', () => {
    expect(humanizeSkillId('ai-video-generation')).toBe('Ai Video Generation');
  });
});
