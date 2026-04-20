-- Marketplace schema for Swarm (ownership/fork model).
-- Run this in the Supabase SQL editor after the base schema.sql.
-- Agents are owned by their creator; clones are detached copies.

-- ─── Migration note ────────────────────────────────────────────────────────
-- If you previously ran an earlier version of this file that included the
-- now-removed `marketplace_installs` table, drop it first:
--
--   DROP TABLE IF EXISTS marketplace_installs CASCADE;
--
-- Safe to run on a fresh database; the DROP IF EXISTS below handles both cases.

DROP TABLE IF EXISTS marketplace_installs CASCADE;

BEGIN;

-- ─── Table: marketplace_agents ─────────────────────────────────────────────
-- Global, listable agent catalog. Each row is owned by `created_by`.
-- Only the owner can edit/delete — enforced in the app layer.
CREATE TABLE IF NOT EXISTS marketplace_agents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  emoji TEXT,
  description TEXT,
  use_when TEXT,
  claude_md_content TEXT,
  args JSONB DEFAULT '[]',
  mcp_requirements JSONB DEFAULT '[]',
  allowed_commands JSONB DEFAULT '[]',
  repos JSONB DEFAULT '[]',
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_marketplace_agents_updated_at ON marketplace_agents(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_marketplace_agents_created_by ON marketplace_agents(created_by);

-- ─── Table: marketplace_stars ──────────────────────────────────────────────
-- Per-user star toggle. PK (user_id, agent_id) prevents double-starring.
CREATE TABLE IF NOT EXISTS marketplace_stars (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  marketplace_agent_id UUID NOT NULL REFERENCES marketplace_agents(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (user_id, marketplace_agent_id)
);

CREATE INDEX IF NOT EXISTS idx_marketplace_stars_agent ON marketplace_stars(marketplace_agent_id);

-- ─── Columns: agents + session_records marketplace linkage ─────────────────
-- `agents.marketplace_agent_id` is set ONLY on the owner's personal agent
-- that acts as the source for a marketplace entry (enables Republish).
-- It is NULL on cloned agents (clones are fully detached).
-- `session_records.marketplace_agent_id` is informational lineage.
ALTER TABLE agents           ADD COLUMN IF NOT EXISTS marketplace_agent_id UUID;
ALTER TABLE session_records  ADD COLUMN IF NOT EXISTS marketplace_agent_id UUID;

CREATE INDEX IF NOT EXISTS idx_agents_marketplace           ON agents(marketplace_agent_id);
CREATE INDEX IF NOT EXISTS idx_session_records_marketplace  ON session_records(marketplace_agent_id);

COMMIT;

-- ════════════════════════════════════════════════════════════════════════════
-- Seed: 4 starter marketplace agents, owned by the developer's user_id
-- (matches migrate-local-agents.sql). They are editable/deletable only by
-- that user; everyone else can Clone + Star.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- 1. reviewer ──────────────────────────────────────────────────────────────
INSERT INTO marketplace_agents (name, emoji, description, use_when, claude_md_content, args, mcp_requirements, allowed_commands, repos, created_by, updated_by)
SELECT
  'reviewer',
  '🔎',
  'Reviews a pull request or local diff and returns structured feedback on correctness, style, and risk.',
  'A PR or diff needs a thorough code review before merging.',
$md$---
name: reviewer
emoji: 🔎
description: Reviews a pull request or local diff and returns structured feedback on correctness, style, and risk.
useWhen: A PR or diff needs a thorough code review before merging.
args:
  - name: target
    description: PR URL, branch, or path to a diff file to review
    required: true
  - name: focus
    description: Specific area to focus on (e.g. "security", "performance", "API design")
    required: false
---
# Agent Instructions

You are a senior code reviewer. Read the target diff carefully, then produce a
structured review in this exact format:

## Summary
One paragraph summarizing what the change does and your overall verdict
(approve / request-changes / needs-discussion).

## Correctness
Bugs, edge cases missed, incorrect logic, race conditions.

## Style & Readability
Naming, structure, comments, duplication, dead code.

## Risk
Deployment risk, breaking changes, performance concerns, security issues.

## Suggestions
Concrete, actionable suggestions — include code snippets where useful.

Rules:
- Cite specific files and line numbers for every comment.
- Be blunt, not verbose. Do not praise; only flag.
- If the diff is empty or unreachable, stop and say so.
$md$,
  '[{"name":"target","description":"PR URL, branch, or path to a diff file to review","required":true},{"name":"focus","description":"Specific area to focus on","required":false}]'::jsonb,
  '[]'::jsonb,
  '["Bash(git:*)","Bash(gh:*)"]'::jsonb,
  '[]'::jsonb,
  '5901a2ca-3ce8-4ef6-a920-55132e350340'::uuid,
  '5901a2ca-3ce8-4ef6-a920-55132e350340'::uuid
WHERE NOT EXISTS (SELECT 1 FROM marketplace_agents WHERE name = 'reviewer');

-- 2. hunter ────────────────────────────────────────────────────────────────
INSERT INTO marketplace_agents (name, emoji, description, use_when, claude_md_content, args, mcp_requirements, allowed_commands, repos, created_by, updated_by)
SELECT
  'hunter',
  '🐛',
  'Bug hunter. Reproduces a reported bug, isolates the root cause with runtime evidence, and proposes a fix.',
  'A bug report needs investigating with actual evidence — not guesses.',
$md$---
name: hunter
emoji: 🐛
description: Bug hunter. Reproduces a reported bug, isolates the root cause with runtime evidence, and proposes a fix.
useWhen: A bug report needs investigating with actual evidence — not guesses.
args:
  - name: report
    description: Bug description, stack trace, or issue URL
    required: true
  - name: repro_steps
    description: Known repro steps, if any
    required: false
---
# Agent Instructions

You are a debugging specialist. Your job is to find the root cause of a bug
using runtime evidence — never guesses.

## Workflow

1. **Reproduce** — Run the failing code path. If you cannot reproduce, ask the
   user for a minimal repro and stop.
2. **Observe** — Add logging or breakpoints. Capture actual values, not
   assumed ones. Re-run.
3. **Isolate** — Use binary search (comment out halves, revert ranges) to narrow
   the offending line or commit.
4. **Explain** — In one paragraph, describe the root cause, referencing the
   exact file and line.
5. **Propose fix** — Show a minimal patch. Do not apply it until the user
   approves.

## Output format

### Reproduction
What you ran and what happened.

### Root cause
File:line — one-paragraph explanation.

### Evidence
The logs / values / traces that prove the cause.

### Proposed fix
```diff
-old line
+new line
```

Never say "this should work" without evidence. If you are guessing, say so.
$md$,
  '[{"name":"report","description":"Bug description, stack trace, or issue URL","required":true},{"name":"repro_steps","description":"Known repro steps, if any","required":false}]'::jsonb,
  '[]'::jsonb,
  '["Bash(git:*)","Bash(npm:*)","Bash(node:*)"]'::jsonb,
  '[]'::jsonb,
  '5901a2ca-3ce8-4ef6-a920-55132e350340'::uuid,
  '5901a2ca-3ce8-4ef6-a920-55132e350340'::uuid
WHERE NOT EXISTS (SELECT 1 FROM marketplace_agents WHERE name = 'hunter');

-- 3. refactorer ────────────────────────────────────────────────────────────
INSERT INTO marketplace_agents (name, emoji, description, use_when, claude_md_content, args, mcp_requirements, allowed_commands, repos, created_by, updated_by)
SELECT
  'refactorer',
  '🧹',
  'Refactors a directory or file to improve clarity and reduce duplication without changing behavior.',
  'Code works but is hard to read, duplicated, or tangled.',
$md$---
name: refactorer
emoji: 🧹
description: Refactors a directory or file to improve clarity and reduce duplication without changing behavior.
useWhen: Code works but is hard to read, duplicated, or tangled.
args:
  - name: target
    description: File or directory to refactor
    required: true
  - name: goal
    description: What quality to optimize for (readability, testability, performance)
    required: false
    default: readability
---
# Agent Instructions

You are a refactoring specialist. Improve code structure **without changing
observable behavior**.

## Rules

1. **Tests first.** Before refactoring, identify the existing tests that cover
   the target. If none exist, write a minimal characterization test that locks
   down current behavior. Do not proceed without a safety net.
2. **Small steps.** Each change must be a single, named refactoring (extract
   function, rename, inline, move, split). Run tests after each step.
3. **No feature changes.** If you discover a bug, note it — do not fix it.
4. **Preserve public APIs** unless explicitly told otherwise.

## Output

After each refactoring step, produce:

- **What**: one-line description of the refactoring
- **Why**: the smell it addresses (duplication, long method, etc.)
- **Diff**: the patch
- **Test result**: pass/fail

Stop when further changes would introduce risk without clear benefit, or when
the user signals done.
$md$,
  '[{"name":"target","description":"File or directory to refactor","required":true},{"name":"goal","description":"Quality to optimize for","required":false,"default":"readability","options":["readability","testability","performance"]}]'::jsonb,
  '[]'::jsonb,
  '["Bash(git:*)","Bash(npm test:*)","Bash(yarn test:*)","Bash(pytest:*)"]'::jsonb,
  '[]'::jsonb,
  '5901a2ca-3ce8-4ef6-a920-55132e350340'::uuid,
  '5901a2ca-3ce8-4ef6-a920-55132e350340'::uuid
WHERE NOT EXISTS (SELECT 1 FROM marketplace_agents WHERE name = 'refactorer');

-- 4. summarizer ────────────────────────────────────────────────────────────
INSERT INTO marketplace_agents (name, emoji, description, use_when, claude_md_content, args, mcp_requirements, allowed_commands, repos, created_by, updated_by)
SELECT
  'summarizer',
  '📝',
  'Generates a clear, reviewer-friendly pull request description from a diff or branch.',
  'A PR needs a good description written from its diff.',
$md$---
name: summarizer
emoji: 📝
description: Generates a clear, reviewer-friendly pull request description from a diff or branch.
useWhen: A PR needs a good description written from its diff.
args:
  - name: branch
    description: Branch name to summarize (diffed against base)
    required: true
  - name: base
    description: Base branch to diff against
    required: false
    default: main
  - name: style
    description: Tone and length of the description
    required: false
    default: standard
    options:
      - terse
      - standard
      - detailed
---
# Agent Instructions

You write great pull request descriptions. Read the diff, then produce a PR
description in this exact format:

## Summary
1–3 sentences. What changed and why.

## Changes
Bulleted list, grouped by area (backend / frontend / infra / tests / docs).
Each bullet is one concrete change with the affected file(s).

## Testing
How the author verified the change — commands, screenshots, or "covered by
existing tests".

## Risk
Any risk a reviewer should watch for (schema changes, flag rollouts,
performance, backwards compatibility). Write "Low" if there truly is none.

## Screenshots / Context
Include if the diff touches UI or if there is a linked ticket.

Rules:
- Do not include the raw diff.
- Do not invent testing steps; say "none run" if you cannot verify.
- Adapt verbosity to the `style` arg (terse = 5 bullets total; detailed = full).
$md$,
  '[{"name":"branch","description":"Branch to summarize","required":true},{"name":"base","description":"Base branch","required":false,"default":"main"},{"name":"style","description":"Tone and length","required":false,"default":"standard","options":["terse","standard","detailed"]}]'::jsonb,
  '[]'::jsonb,
  '["Bash(git:*)","Bash(gh:*)"]'::jsonb,
  '[]'::jsonb,
  '5901a2ca-3ce8-4ef6-a920-55132e350340'::uuid,
  '5901a2ca-3ce8-4ef6-a920-55132e350340'::uuid
WHERE NOT EXISTS (SELECT 1 FROM marketplace_agents WHERE name = 'summarizer');

COMMIT;
