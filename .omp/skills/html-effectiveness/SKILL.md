---
name: html-effectiveness
version: 1.0.0
description: |
  Generate self-contained, interactive HTML documents instead of markdown walls of text.
  When output is complex (comparisons, timelines, multi-option decisions, data tables,
  code reviews, diagrams), produce a single .html file that renders spatially and
  interactively in the browser. Zero dependencies, zero build steps. Inspired by
  "The Unreasonable Effectiveness of HTML" (https://thariqs.github.io/html-effectiveness/).
  Use when: output would be long markdown, comparing options, presenting data, reviewing
  code, building plans, explaining concepts, or any multi-dimensional information.
  Trigger: "make it visual", "interactive output", "HTML instead of markdown", complex
  analysis results.
triggers:
  - make it visual
  - interactive output
  - HTML instead of markdown
allowed-tools:
  - Bash
  - Read
  - Write
  - Edit
  - Glob
  - Grep
  - AskUserQuestion
---

# HTML Effectiveness: Interactive Output Engine

## Core Principle

**Markdown is a wall of text. HTML is a spatial, interactive document.**

When you have multi-dimensional information to present, generate a single self-contained HTML file that users can explore, filter, compare, and interact with. The browser is the universal runtime - no build steps, no dependencies, no exports needed.

## When to Use This Skill

**Use HTML output when ANY of these are true:**
- Comparing 2+ options with trade-offs (side-by-side cards)
- Presenting data with >5 rows (sortable/filterable table)
- Showing a timeline or sequence of events
- Explaining a concept with collapsible sections
- Reviewing code changes (annotated diffs)
- Presenting a plan with phases and dependencies
- Showing architecture or system design (boxes + arrows)
- Any output where the reader needs to SCAN, not read linearly
- Any output where the reader needs to CHOOSE between options
- Any output with tabular data, charts, or visual relationships

**Use plain markdown when:**
- Simple Q&A (one paragraph answer)
- Inline code fixes
- Brief status updates
- Sequential instructions (do X, then Y, then Z)

## 9 Output Patterns

Select the pattern that matches your information type:

### 1. Comparison Board
**When:** Evaluating approaches, tools, libraries, strategies
**Structure:** Side-by-side cards with clear trade-offs, rating badges, recommendation highlight
**Interaction:** Hover to highlight, click to expand details

### 2. Annotated Timeline
**When:** Incident post-mortems, project plans, history, implementation phases
**Structure:** Vertical timeline with colored nodes, expandable details per step
**Interaction:** Click nodes to expand/collapse, filter by category

### 3. Interactive Report
**When:** Status updates, analysis results, research findings
**Structure:** Header stats, filterable sections, charts via inline SVG
**Interaction:** Category filters, collapsible deep-dives, search

### 4. Code Review Board
**When:** PR reviews, refactoring proposals, architecture changes
**Structure:** File-by-file cards with severity tags, before/after diffs, inline comments
**Interaction:** Filter by severity, expand file details, toggle diff view

### 5. Decision Matrix
**When:** Choosing between options with multiple criteria
**Structure:** Grid with options as columns, criteria as rows, scored cells with color intensity
**Interaction:** Sort by score, hover for rationale, highlight winner

### 6. Knowledge Explorer
**When:** Explaining concepts, teaching, documenting systems
**Structure:** Collapsible sections, tabbed code examples, glossary with hover definitions
**Interaction:** Expand/collapse all, search within content, anchor links

### 7. Kanban / Workflow Board
**When:** Task management, triage, process visualization
**Structure:** Drag-and-drop columns with cards
**Interaction:** Drag cards between columns, export state as markdown

### 8. Design System / Token Sheet
**When:** Presenting design decisions, component variants, style guide
**Structure:** Color swatches with copy-on-click, typography scale, spacing reference
**Interaction:** Click to copy hex values, preview at different sizes

### 9. Slide Deck
**When:** Presentations, walkthroughs, pitch-style content
**Structure:** Arrow-key navigable slides, minimal JS (~20 lines)
**Interaction:** Left/Right arrow keys, click indicators, fullscreen

## HTML Generation Rules

### Always Include
- Single `.html` file, fully self-contained (no external deps)
- `<style>` in `<head>`, `<script>` before `</body>`
- CSS custom properties for theming (light + dark via `prefers-color-scheme`)
- System font stack: `-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`
- Smooth transitions (150ms ease) on interactive elements
- Responsive: works at 375px mobile through 1440px desktop
- Semantic HTML5 (`<header>`, `<main>`, `<section>`, `<nav>`)
- `aria-expanded`, `role`, `tabindex` for interactive elements
- Print styles (`@media print`) that show all content expanded

### Visual Design System
```css
:root {
  --bg: #fafaf9;
  --surface: #ffffff;
  --text: #1c1917;
  --text-muted: #78716c;
  --border: #e7e5e4;
  --accent: #2563eb;
  --accent-light: #eff6ff;
  --success: #16a34a;
  --warning: #d97706;
  --danger: #dc2626;
  --radius: 8px;
  --shadow: 0 1px 3px rgba(0,0,0,0.1);
  --shadow-hover: 0 4px 12px rgba(0,0,0,0.15);
}

@media (prefers-color-scheme: dark) {
  :root {
    --bg: #1c1917;
    --surface: #292524;
    --text: #fafaf9;
    --text-muted: #a8a29e;
    --border: #44403c;
    --accent-light: #1e3a5f;
  }
}
```

### Interaction Patterns
- **Cards:** `transform: translateY(-2px)` + shadow elevation on hover
- **Collapsibles:** `max-height` transition with `overflow: hidden`, `aria-expanded` toggle
- **Tabs:** Click to switch panel visibility, `aria-selected` state
- **Filters:** Data attributes on items, JS filter by `dataset.category`
- **Search:** `input` event listener, `display: none` on non-matching items
- **Copy-on-click:** `navigator.clipboard.writeText()` with temporary "Copied!" feedback

### Content Rules
- **Real data only** - never use lorem ipsum or placeholder content
- **Scannable** - visual hierarchy via size, color, and spacing (not just bold/italic)
- **Spatial** - related items grouped visually, not separated by long paragraphs
- **Progressive disclosure** - summary visible, details on click/expand
- **Decision-oriented** - if comparing options, highlight the recommendation

### Anti-Patterns (Never Do This)
- Purple/blue gradient backgrounds as default
- Generic "feature grid" with icons
- Center-everything layout with no hierarchy
- Decorative blobs, waves, geometric patterns
- Stock photo placeholders
- Cookie-cutter SaaS landing page templates
- Emoji as primary visual elements
- Walls of text inside the HTML (defeats the purpose)

## Workflow

### Step 1: Classify the Output
Ask: "What information am I presenting?" Match to one of the 9 patterns above.

### Step 2: Structure the Data
Extract the key dimensions:
- **Comparison:** options, criteria, scores, recommendation
- **Timeline:** events, timestamps, categories, details
- **Report:** metrics, sections, status indicators
- **Decision:** choices, trade-offs, context

### Step 3: Ask Save Location & Generate HTML
Use `AskUserQuestion` to ask the user where to save the HTML file. Default recommendation: `./output/{pattern}-{topic}-YYYYMMDD.html`. After user confirms or provides a custom path, write a single `.html` file using the Write tool to that location.

### Step 4: Open in Browser
```bash
open <path-to-file.html>
```
Or serve locally:
```bash
cd $(dirname <path>) && python3 -m http.server 0 --bind 127.0.0.1 &
```

### Step 5: Refinement Loop
1. Show the HTML to the user
2. Ask: "What needs to change?"
3. Apply surgical edits (Edit tool, not full rewrite)
4. Repeat until satisfied

## Example: Comparison Board

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>方案对比</title>
<style>
  :root {
    --bg: #fafaf9; --surface: #fff; --text: #1c1917;
    --muted: #78716c; --border: #e7e5e4; --accent: #2563eb;
    --success: #16a34a; --warning: #d97706; --danger: #dc2626;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #1c1917; --surface: #292524; --text: #fafaf9;
      --muted: #a8a29e; --border: #44403c;
    }
  }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    background: var(--bg); color: var(--text); line-height: 1.6;
    padding: 2rem; max-width: 1200px; margin: 0 auto;
  }
  h1 { font-size: 1.75rem; margin-bottom: 0.5rem; }
  .subtitle { color: var(--muted); margin-bottom: 2rem; }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
    gap: 1.5rem;
  }
  .card {
    background: var(--surface); border: 1px solid var(--border);
    border-radius: 8px; padding: 1.5rem;
    transition: transform 150ms ease, box-shadow 150ms ease;
  }
  .card:hover {
    transform: translateY(-2px);
    box-shadow: 0 4px 12px rgba(0,0,0,0.15);
  }
  .card.recommended { border-color: var(--accent); border-width: 2px; }
  .badge {
    display: inline-block; padding: 2px 8px; border-radius: 4px;
    font-size: 0.75rem; font-weight: 600;
  }
  .badge-rec { background: var(--accent); color: white; }
  .badge-pro { background: #dcfce7; color: #166534; }
  .badge-con { background: #fef2f2; color: #991b1b; }
  .card h2 { font-size: 1.25rem; margin-bottom: 0.75rem; }
  .card ul { list-style: none; padding: 0; }
  .card li { padding: 0.25rem 0; }
  details { margin-top: 1rem; }
  summary { cursor: pointer; color: var(--accent); font-size: 0.9rem; }
  @media print {
    details[open] summary ~ * { display: block !important; }
    .card { break-inside: avoid; border: 1px solid #ccc; }
  }
</style>
</head>
<body>
  <h1>技术方案对比</h1>
  <p class="subtitle">3 个候选方案，基于性能、成本、维护性评估</p>
  <div class="grid">
    <!-- Card 1: Recommended -->
    <div class="card recommended">
      <h2>方案 A: GraphQL <span class="badge badge-rec">推荐</span></h2>
      <p>灵活查询，减少 over-fetching</p>
      <ul>
        <li><span class="badge badge-pro">+</span> 精确获取所需字段</li>
        <li><span class="badge badge-pro">+</span> 强类型 schema</li>
        <li><span class="badge badge-con">-</span> 学习曲线较陡</li>
      </ul>
      <details>
        <summary>详细分析</summary>
        <p>适合数据关系复杂、客户端需求多样的场景...</p>
      </details>
    </div>
    <!-- More cards... -->
  </div>
</body>
</html>
```

## Integration with Other Skills

- After `/investigate` produces findings → generate incident timeline HTML
- After `/review` produces code review → generate review board HTML
- After `/plan-ceo-review` produces strategy → generate comparison board
- After analysis tasks → generate interactive report
- After complex research → generate knowledge explorer

## Save Location Convention (Default Recommendation)

Default path: `./output/`, with naming `{pattern}-{topic}-YYYYMMDD.html`.
Examples:
- `./output/comparison-api-design-20260526.html`
- `./output/timeline-incident-review-20260526.html`
- `./output/report-performance-analysis-20260526.html`
- `./output/review-pr-refactor-20260526.html`

Always ask the user before writing; the above is the recommended default only.

## Completion

After generating HTML output:
1. Open in browser for user to see
2. Offer refinement loop
3. Report: file path, pattern used, key features