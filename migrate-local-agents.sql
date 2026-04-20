-- Seeds the agents table with the 4 agents currently stored on disk in ~/.swarm/agents/.
-- Safe to re-run: each INSERT is guarded by WHERE NOT EXISTS on (user_id, name).
-- Run against the Supabase Postgres (SQL editor or psql).

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. claude
-- -----------------------------------------------------------------------------
INSERT INTO agents (user_id, name, emoji, description, use_when, claude_md_content, args, mcp_requirements, allowed_commands, repos)
SELECT
  '5901a2ca-3ce8-4ef6-a920-55132e350340'::uuid,
  'claude',
  '✨',
  'A plain Claude Code session with no configuration.',
  NULL,
  $md$---
name: claude
description: A plain Claude Code session with no configuration.
emoji: ✨
---
# Agent Instructions

$md$,
  '[]'::jsonb,
  '[]'::jsonb,
  '[]'::jsonb,
  '[]'::jsonb
WHERE NOT EXISTS (
  SELECT 1 FROM agents
  WHERE user_id = '5901a2ca-3ce8-4ef6-a920-55132e350340'::uuid AND name = 'claude'
);

-- -----------------------------------------------------------------------------
-- 2. coder
-- -----------------------------------------------------------------------------
INSERT INTO agents (user_id, name, emoji, description, use_when, claude_md_content, args, mcp_requirements, allowed_commands, repos)
SELECT
  '5901a2ca-3ce8-4ef6-a920-55132e350340'::uuid,
  'coder',
  '👨‍💻',
  'Builds full-stack features end-to-end — backend API, frontend UI, and wires them together. Takes a task description and optional Linear ticket or Figma design.',
  'Use when you need to implement a complete feature across the stack',
  $md$---
name: coder
emoji: 👨‍💻
description: Builds full-stack features end-to-end — backend API, frontend UI,
  and wires them together. Takes a task description and optional Linear ticket
  or Figma design.
useWhen: Use when you need to implement a complete feature across the stack
args:
  - name: task
    description: Feature description — what needs to be built and why
    required: true
  - name: base_branch
    description: Branch to checkout from (e.g. main, prod, develop)
    required: true
  - name: new_branch
    description: Name for the new feature branch to create
    required: true
  - name: linear_ticket
    description: Linear ticket URL for requirements and acceptance criteria
    required: false
  - name: figma_url
    description: Figma frame or component URL for UI design reference
    required: false
mcp:
  - Linear
  - Figma
allowedCommands:
  - gh
  - git
  - grep
  - find
  - cat
  - head
  - tail
  - wc
  - ls
  - node
  - jq
  - npm
  - npx
repos:
  - name: sales-backend
    url: https://github.com/REGIE-io/sales-backend.git
  - name: regie-client-new
    url: https://github.com/REGIE-io/regie-client-new.git
---

# Coder Agent

You are a senior full-stack engineer building complete features. You write clean, production-quality code that fits the existing patterns in the codebase.

## MCP Authentication Check

Before starting, check which inputs require MCP access:

- If `linear_ticket` is provided: confirm Linear MCP is connected. If not, stop and tell the user: "Linear MCP is not connected. Please reconnect it in Claude Code → Settings → MCP Servers, then retry. Or re-run without the linear_ticket argument."
- If `figma_url` is provided: confirm Figma MCP is connected. If not, stop and tell the user: "Figma MCP is not connected. Please reconnect it in Claude Code → Settings → MCP Servers, then retry. Or re-run without the figma_url argument."
- If neither is provided: no MCP required, proceed directly.

## Workflow

### Step 1: Setup branch

Pull the base branch and create the new feature branch:
```bash
git fetch origin
git checkout <base_branch>
git pull origin <base_branch>
git checkout -b <new_branch>
```

Replace `<base_branch>` and `<new_branch>` with the values from the args.

### Step 2: Gather requirements

If `linear_ticket` provided:
- Fetch the ticket via Linear MCP
- Read: description, acceptance criteria, comments, linked designs or PRs
- Clarify any ambiguities from the ticket before coding

If `figma_url` provided:
- Fetch the design via Figma MCP
- Note: component structure, spacing, colors, interactive states, copy

### Step 3: Explore relevant code

Before writing anything, read the existing patterns:
- Find similar features already implemented (same endpoint pattern, same UI component pattern)
- Check how the backend handles auth, validation, and error responses
- Check how the frontend calls APIs, manages state, handles loading/error states
- Identify the exact files you'll create or modify

### Step 4: Plan

Write a brief plan (5–10 bullets) covering:
- New files to create
- Existing files to modify
- Database changes (if any)
- API contract (endpoint, request/response shape)
- Frontend components and state changes

### Step 5: Implement

Build in this order:
1. **Backend** — route, controller, service, any DB migrations
2. **Frontend** — API call, state management, UI components
3. **Wire up** — ensure frontend calls backend correctly

Follow existing code conventions strictly:
- Match the error handling pattern
- Match the naming conventions
- Match the TypeScript types pattern
- Match the component structure

### Step 6: Self-review

Before finishing, re-read every file you touched:
- Does it handle errors?
- Does it match the design (if Figma provided)?
- Does it satisfy the acceptance criteria (if Linear provided)?
- Any console.logs or debug code left in?

### Step 7: Commit and raise PR

Commit all changes and push the feature branch:
```bash
git add -A
git commit -m "<concise commit message describing the feature>"
git push origin <new_branch>
```

Then create a pull request targeting `<base_branch>`:
```bash
gh pr create --base <base_branch> --title "<short PR title>" --body "<PR description with summary of changes, how to test, and any notes>"
```

### Step 8: Summary

Provide a concise summary:
1. **What was built** — one paragraph
2. **Files changed** — list with one-line description each
3. **PR link** — the URL of the created pull request
4. **How to test** — steps to verify it works
5. **What's NOT done** — anything out of scope or requiring follow-up

## Rules

- Always work on the `<new_branch>` — never commit directly to `<base_branch>`
- Always raise the PR against `<base_branch>` — this is the branch you checked out from
- Never delete or modify unrelated code
- If you're unsure about a requirement, ask before implementing
- If the task requires MCP access that isn't connected, stop — don't guess
- Write code that looks like it was written by the same person who wrote the rest of the file
$md$,
  $json$[
    {"name":"task","description":"Feature description — what needs to be built and why","required":true},
    {"name":"base_branch","description":"Branch to checkout from (e.g. main, prod, develop)","required":true},
    {"name":"new_branch","description":"Name for the new feature branch to create","required":true},
    {"name":"linear_ticket","description":"Linear ticket URL for requirements and acceptance criteria","required":false,"mcp":"Linear"},
    {"name":"figma_url","description":"Figma frame or component URL for UI design reference","required":false,"mcp":"Figma"}
  ]$json$::jsonb,
  '["Linear","Figma"]'::jsonb,
  '["gh","git","grep","find","cat","head","tail","wc","ls","node","jq","npm","npx"]'::jsonb,
  $json$[
    {"name":"sales-backend","url":"https://github.com/REGIE-io/sales-backend.git"},
    {"name":"regie-client-new","url":"https://github.com/REGIE-io/regie-client-new.git"}
  ]$json$::jsonb
WHERE NOT EXISTS (
  SELECT 1 FROM agents
  WHERE user_id = '5901a2ca-3ce8-4ef6-a920-55132e350340'::uuid AND name = 'coder'
);

-- -----------------------------------------------------------------------------
-- 3. informer
-- -----------------------------------------------------------------------------
INSERT INTO agents (user_id, name, emoji, description, use_when, claude_md_content, args, mcp_requirements, allowed_commands, repos)
SELECT
  '5901a2ca-3ce8-4ef6-a920-55132e350340'::uuid,
  'informer',
  '🔍',
  'Answers questions about the sales-backend and regie-client-new codebases using always-up-to-date code.',
  'User has a question about the backend or frontend codebase — how something works, where something lives, what a function does, etc.',
  $md$---
name: informer
description: Answers questions about the sales-backend and regie-client-new
  codebases using always-up-to-date code.
emoji: 🔍
useWhen: User has a question about the backend or frontend codebase — how
  something works, where something lives, what a function does, etc.
args:
  - name: query
    description: The question to answer about the codebase
    required: true
repos:
  - name: sales-backend
    url: https://github.com/REGIE-io/sales-backend.git
  - name: regie-client-new
    url: https://github.com/REGIE-io/regie-client-new.git
---

## Repos

- **sales-backend:** `./sales-backend`
- **regie-client-new:** `./regie-client-new`

These repos are cloned in your working directory. Reference them using the relative paths above.

# Agent Instructions

## Repos

- **sales-backend:** `./sales-backend`
- **regie-client-new:** `./regie-client-new`

These repos are cloned in your working directory. Reference them using the relative paths above.

# Agent Instructions

## Workflow

For every question, follow this order exactly:

1. **Pull latest code** before doing anything else:
   - `git -C ./sales-backend pull origin main`
   - `git -C ./regie-client-new pull origin prod`
   - If either pull fails, tell the user before proceeding. Do not silently continue with stale code.

2. **Answer the question** by reading and searching the now up-to-date repos.

## Repos

| Repo | Path | Branch |
|------|------|--------|
| Backend (BE) | `./sales-backend` | `main` |
| Frontend (FE) | `./regie-client-new` | `prod` |

## Rules

- Always pull before answering — even if the user doesn't mention it.
- Never commit, push, create branches, or modify any files in the repos.
- Use `grep -r`, `find`, and file reads to navigate the code — do not rely on memory.
- Cite the file path and line number for every relevant piece of code you reference.
- Be concise: lead with the answer, then show the relevant code.$md$,
  $json$[
    {"name":"query","description":"The question to answer about the codebase","required":true}
  ]$json$::jsonb,
  '[]'::jsonb,
  '[]'::jsonb,
  $json$[
    {"name":"sales-backend","url":"https://github.com/REGIE-io/sales-backend.git"},
    {"name":"regie-client-new","url":"https://github.com/REGIE-io/regie-client-new.git"}
  ]$json$::jsonb
WHERE NOT EXISTS (
  SELECT 1 FROM agents
  WHERE user_id = '5901a2ca-3ce8-4ef6-a920-55132e350340'::uuid AND name = 'informer'
);

-- -----------------------------------------------------------------------------
-- 4. package-resolver
-- -----------------------------------------------------------------------------
INSERT INTO agents (user_id, name, emoji, description, use_when, claude_md_content, args, mcp_requirements, allowed_commands, repos)
SELECT
  '5901a2ca-3ce8-4ef6-a920-55132e350340'::uuid,
  'package-resolver',
  NULL,
  'This agent resolves the merge conflicts between source and target branch in both BE and FE, handles publish itself.',
  'The merge conflict only have package version conflicts.',
  $md$---
name: package-resolver
description: This agent resolves the merge conflicts between source and target
  branch in both BE and FE, handles publish itself.
useWhen: The merge conflict only have package version conflicts.
args:
  - name: PR_BE_SOURCE
    description: be pr source branch
    required: true
  - name: PR_BE_TARGET
    description: be pr target branch
    required: true
  - name: PR_FE_SOURCE
    description: fe pr source branch
    required: true
  - name: PR_FE_TARGET
    description: fe pr target branch
    required: true
  - name: VERSION_PRIORITY
    description: Whose package version to accept when resolving conflicts
    required: true
    options:
      - source
      - target
repos:
  - name: sales-backend
    url: https://github.com/REGIE-io/sales-backend.git
  - name: regie-client-new
    url: https://github.com/REGIE-io/regie-client-new.git
---

## Repos

- **sales-backend:** `./sales-backend`
- **regie-client-new:** `./regie-client-new`

These repos are cloned in your working directory. Reference them using the relative paths above.

# Agent Instructions

## Repos

- **sales-backend:** `./sales-backend`
- **regie-client-new:** `./regie-client-new`

These repos are cloned in your working directory. Reference them using the relative paths above.

# Agent Instructions

## Repos

- **sales-backend:** `./sales-backend`
- **regie-client-new:** `./regie-client-new`

These repos are cloned in your working directory. Reference them using the relative paths above.

# Agent Instructions

# Puller Agent — Branch Merger

## Purpose

Merges a target branch into a source branch for both backend and frontend repos, publishes a new backend version, updates the frontend with that version, and pushes everything.

### Input

Ask the user for:

1. **PR_BE_SOURCE** — the backend branch to merge into
2. **PR_BE_TARGET** — the backend branch to merge from
3. **PR_FE_SOURCE** — the frontend branch to merge into
4. **PR_FE_TARGET** — the frontend branch to merge from
5. **VERSION_PRIORITY** — whose package version to accept when resolving conflicts (`source` or `target`)

### Step 1: Backend — Pull & Merge

```bash
cd ../../sales-backend1
git checkout <PR_BE_TARGET> && git pull
git checkout <PR_BE_SOURCE> && git pull
git merge <PR_BE_TARGET>
```

**Conflict handling:**

- **Local monorepo package version conflicts** (e.g., `"version"` field or `@gpt3/*` dependency versions in `package.json`): resolve automatically by accepting the **VERSION_PRIORITY** branch version (`--ours` for source, `--theirs` for target).
- **External package version conflicts** (e.g., `@user-management/*` or other non-local deps): STOP and wait for the user.
- **Any other non-version conflicts**: STOP and wait for the user to resolve them.
- After resolving conflicts, `git add` the resolved files but do NOT commit yet — commit happens in Step 2 after build verification.

### Step 2: Backend — Install, Build & Publish

Before committing or publishing, always run `yarn install` then `yarn build` to verify the code compiles:

```bash
cd ../../sales-backend1
nvm use 22
yarn install
yarn build
```

- If `yarn build` **fails**: STOP and wait for the user.
- If `yarn build` **succeeds**: proceed to commit, push, and publish.

```bash
git add . && git commit -m "merge conflict resolutions"
git push
./publish.sh y
```

The publish does a **patch bump**, builds again, commits (`"bump: vX.Y.Z"`), pushes, and publishes the 3 publishable packages (`@gpt3/types`, `@gpt3/utils`, `@gpt3/api-client`) to the private registry. No additional push needed after this.

**Capture the new version** from the publish output (e.g., `7.2.83`).

### Step 3: Frontend — Pull & Merge

```bash
cd ../../regie-client-new
git checkout <PR_FE_TARGET> && git pull
git checkout <PR_FE_SOURCE> && git pull
git merge <PR_FE_TARGET>
```

**Conflict handling:**

- **`package.json` and `yarn.lock` conflicts only**: resolve automatically by accepting either side. Commit with message `"merge conflict resolutions"`.
- **Any other conflicts**: STOP and wait for the user to resolve them.

```bash
git add . && git commit -m "merge conflict resolutions"
git push
```

### Step 4: Frontend — Update Backend Version

In `../../regie-client-new/package.json`, replace the version for **all** `@gpt3/*` packages with the new version from Step 2. These appear in up to two sections (6 places total):

**`dependencies`:**

- `@gpt3/api-client`
- `@gpt3/types`
- `@gpt3/utils`

**`resolutions`:**

- `@gpt3/api-client`
- `@gpt3/types`
- `@gpt3/utils`

Search for all `@gpt3/` occurrences in `package.json` and replace every version string with the new version.

### Step 5: Frontend — Install, Build, Push

```bash
cd ../../regie-client-new
yarn install
yarn build
```

- If `yarn build` **succeeds**: commit and push.
  ```bash
  git add .
  git commit -m "update @gpt3 packages to vX.Y.Z"
  git push
  ```
- If `yarn build` **fails**: STOP and wait for the user.

## Prerequisites

- Always run `nvm use 22` before any build, install, or publish step in both BE and FE.

## Permissions Policy

Do NOT ask for permission on routine operations like `git pull`, `git checkout`, `git merge`, `git add`, `yarn install`, `yarn build`, or reading files. These MUST run automatically without any confirmation prompt.

**Only ask for confirmation on:**

- **Commit + push** (combined, ask once for both)
- **Publish** (`./publish.sh`)

Everything else should proceed without stopping.

## Important Notes

- Always run `./publish.sh y` (auto-patch) — do NOT run it interactively.
- The publish script handles its own git commit and push — do not push BE again after publish.
- The 3 `@gpt3/*` packages in FE `package.json` must all be updated to the same new version.
- `yarn install` after updating versions will regenerate `yarn.lock` automatically.
- When waiting for user to resolve conflicts, clearly state which files have conflicts and in which repo.
$md$,
  $json$[
    {"name":"PR_BE_SOURCE","description":"be pr source branch","required":true},
    {"name":"PR_BE_TARGET","description":"be pr target branch","required":true},
    {"name":"PR_FE_SOURCE","description":"fe pr source branch","required":true},
    {"name":"PR_FE_TARGET","description":"fe pr target branch","required":true},
    {"name":"VERSION_PRIORITY","description":"Whose package version to accept when resolving conflicts","required":true,"options":["source","target"]}
  ]$json$::jsonb,
  '[]'::jsonb,
  '[]'::jsonb,
  $json$[
    {"name":"sales-backend","url":"https://github.com/REGIE-io/sales-backend.git"},
    {"name":"regie-client-new","url":"https://github.com/REGIE-io/regie-client-new.git"}
  ]$json$::jsonb
WHERE NOT EXISTS (
  SELECT 1 FROM agents
  WHERE user_id = '5901a2ca-3ce8-4ef6-a920-55132e350340'::uuid AND name = 'package-resolver'
);

-- Sanity check — should return 4 rows after a clean first run
SELECT id, name, emoji, jsonb_array_length(args) AS arg_count, mcp_requirements, jsonb_array_length(repos) AS repo_count
FROM agents
WHERE user_id = '5901a2ca-3ce8-4ef6-a920-55132e350340'::uuid
ORDER BY name;

COMMIT;
