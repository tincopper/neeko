---
name: trellis-brainstorm
description: "Guides collaborative requirements discovery before implementation. Creates task directory, seeds PRD, asks high-value questions one at a time, researches technical choices, and converges on MVP scope. Use when requirements are unclear, there are multiple valid approaches, or the user describes a new feature or complex task."
---

# Trellis Brainstorm

## Non-Negotiable Interview Contract

Interview me relentlessly about every aspect of this plan until we reach a shared understanding. Walk down each branch of the design tree, resolving dependencies between decisions one-by-one. For each question, provide your recommended answer.

Ask the questions one at a time.

## Non-Negotiable Evidence Rule

If a question can be answered by exploring the codebase, explore the codebase instead.

This is mandatory. Before asking the user a question, first check whether the answer is already available in code, tests, configs, docs, existing specs, or task history.

Do not ask the user to confirm facts that the repository can answer. Ask only for product intent, preference, scope, risk tolerance, or decisions that remain ambiguous after inspection.

---

Use this skill during Phase 1 planning to turn the user's request into clear requirements and planning artifacts.

## Preconditions

Use this skill **only for L2 complex tasks** (per the complexity classification in `workflow.md` Request Triage). L1 simple/lightweight tasks must NOT create a Trellis task — implement them inline with `trellis-before-dev` and quality checks.

Before creating a task, classify the request:

| 级别 | 判定条件 | 行动 |
|---|---|---|
| **L1 简单/轻量** | 单一关注点；改动 ≤ 3 个文件且在同一层/同一 feature；无跨层；无设计/API 决策；单次会话可完成 | **不创建任务**。不要加载本 skill；直接内联实现。 |
| **L2 复杂** | 多关注点/多交付物；跨层或多包；新功能或需设计权衡；API/契约/迁移变更；高风险长周期 | 先确认用户同意创建任务，再进入本 skill。 |

Use this skill only after task-creation consent has been given (for an L2 task) and the user is ready to enter Trellis planning.

If no task exists yet, create one:

```bash
TASK_DIR=$(python3 ./.trellis/scripts/task.py create "<short task title>" --slug <slug>)
```

Use a concise title from the user's request. Use a slug without a date prefix. `task.py create` adds the `MM-DD-` directory prefix automatically.

`task.py create` creates the default `prd.md`. Update that file with the current understanding before asking follow-up questions.

## Planning Flow

1. Capture the user's request and initial known facts in `prd.md`.
2. Inspect available evidence before asking questions:
   - code, tests, fixtures, and configs
   - README files, docs, existing specs, and domain notes
   - related Trellis tasks, research files, and session history when present
3. Separate what you found into:
   - confirmed facts
   - product intent still needed from the user
   - scope or risk decisions still needed from the user
   - likely out-of-scope items
4. Ask the single highest-value remaining question.
5. Include your recommended answer with the question.
6. After each user answer, update `prd.md` before continuing.
7. For complex tasks, create or update `design.md` and `implement.md` before implementation starts.
8. Before final review or `task.py start`, run the PRD convergence pass below.

Do not invent a project-specific product/spec hierarchy. If the repository already has product, domain, or spec docs, use them. If it does not, proceed with the evidence that exists.

## Question Rules

Ask only one question per message.

Each question must include:

- the decision needed
- why the answer matters
- your recommended answer
- the trade-off if the user chooses differently

Do not ask process questions such as whether to search, inspect files, or continue brainstorming. Do the evidence work directly. Ask the user only when the remaining issue is a product decision, preference, scope boundary, or risk tolerance choice.

## Thinking Framework: First Principles Analysis

When requirements are vague, solutions feel over-engineered, or you're about to add complexity "because everyone does" — decompose to fundamental truths before reasoning upward.

### Step 1: Restate the Problem

Strip away implementation details to one sentence.

> Bad: "We need to add Redis caching to the user profile endpoint"
> Good: "User profile data takes too long to load"

### Step 2: List Fundamental Truths

What is absolutely true (not opinion or convention)?

| Category | Examples |
|----------|----------|
| **Physical constraints** | Network latency ≥ 0, disk I/O has limits |
| **Business rules** | "Users must see their own data" |
| **Technical invariants** | "Data must be consistent" |
| **User needs** | "The user wants X within Y seconds" |

### Step 3: Challenge Assumptions

For each component of the current plan:

- **Fact or convention?** "We always use REST" — why?
- **What if we removed this?** If nothing breaks, it's unnecessary.
- **Solving the actual problem or a symptom?** Trace the causal chain.
- **Who benefits from this complexity?** If "nobody", simplify.

### Step 4: Build Up from Truths

1. Start with the minimum viable mechanism satisfying all truths
2. Add complexity only when a specific truth demands it
3. Each addition must answer: "Which truth requires this?"

### Step 5: Validate

- Does the solution solve the original problem?
- What assumptions need verification?
- What's the simplest experiment to test this?

## Artifact Rules

`prd.md` records requirements and acceptance:

- goal and user value
- confirmed facts
- requirements
- acceptance criteria
- out of scope
- open questions that still block planning

`design.md` records technical design for complex tasks:

- architecture and boundaries
- data flow and contracts
- compatibility and migration notes
- important trade-offs
- operational or rollback considerations

`implement.md` records execution planning for complex tasks:

- ordered implementation checklist
- validation commands
- risky files or rollback points
- follow-up checks before `task.py start`

Lightweight tasks may have only `prd.md`. Complex tasks must have `prd.md`, `design.md`, and `implement.md` before `task.py start`.

`implement.md` is not a replacement for `implement.jsonl`. On sub-agent-dispatch workflows, `implement.jsonl` and `check.jsonl` must each contain at least one real spec/research entry before `task.py start`; the seed `_example` row does not count. Inline workflows skip this JSONL gate because Phase 2 loads context through `trellis-before-dev`.

## PRD Convergence Pass

Before declaring planning ready or running `task.py start`, rewrite `prd.md` once against the final structure described in the artifact rules above. This is not optional cleanup; it is the final planning gate.

The pass must be lossless:

- Collapse repeated facts into one authoritative section.
- Fold temporary brainstorm sections such as `What I already know`, `Assumptions`, and resolved `Open Questions` into Goal, Background, Requirements, Technical Notes, or Acceptance Criteria.
- Remove resolved open questions instead of leaving empty or already-answered sections.
- Merge parallel bug and requirement lists when they describe the same work; keep each defect's severity, evidence, and file:line anchors on the owning requirement.
- Preserve every file:line anchor, decision, constraint, requirement ID, and acceptance-criteria mapping.
- Keep only genuinely blocking open questions.

After the pass, read `prd.md` top to bottom and verify that no fact is repeated across sections unless the repetition adds new information.

## Quality Bar

Before declaring planning ready:

- `prd.md` contains testable acceptance criteria.
- `prd.md` has passed the PRD convergence pass: no unresolved temporary brainstorm sections, no duplicate facts across sections, and no lost anchors, decisions, or acceptance mappings.
- Repository-answerable questions have already been answered through inspection.
- Remaining open questions are genuinely about user intent or scope.
- Complex tasks have `design.md` and `implement.md`.
- Sub-agent-dispatch tasks have real curated entries in both `implement.jsonl` and `check.jsonl`; seed-only manifests are not ready.

## Hard Gate Before Implementation

Do NOT write any code, run `task.py start`, or dispatch an implement sub-agent until **all three** hold:

1. **文档完成**：本任务级别要求的全部规划文档完成并经 review（复杂任务：`prd.md` + `design.md` + `implement.md` 齐备）。
2. **用户明确确认**：向用户呈现「文档已完成」摘要，并明确请求确认「可以开始实现吗？」—— 必须得到用户明确的同意（"可以/开始吧/执行"等）。仅"同意创建任务"或默认沉默不算确认。
3. **任务激活**：`task.py start` 已执行（status = `in_progress`）。

If the user pushes to start coding while docs are incomplete or unconfirmed, do not comply — complete the planning artifacts, present them, and ask for explicit confirmation first.
