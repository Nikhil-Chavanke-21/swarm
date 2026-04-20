import { readdir, readFile, mkdir, writeFile, rename, stat } from 'fs/promises'
import { v4 as uuid } from 'uuid'
import { join } from 'path'
import { homedir } from 'os'
import { stringify as stringifyYaml } from 'yaml'
import { spawn } from 'child_process'
import { BrowserWindow } from 'electron'
import { spawnPty } from './pty-manager'
import { addSessionRecord, closeSessionRecord, updateSessionClaudeId } from './session-manager'
import { deleteAllCrons, reinstallCrons } from './cron-manager'
import {
  getAgents as repoGetAgents,
  getAgent as repoGetAgent,
  createAgent as repoCreateAgent,
  updateAgent as repoUpdateAgent,
  deleteAgent as repoDeleteAgent,
  getInstances as repoGetInstances,
  createInstance as repoCreateInstance,
  updateInstance as repoUpdateInstance,
  deleteInstance as repoDeleteInstance,
} from './database/repositories'

export interface AgentArg {
  name: string
  description: string
  required: boolean
  default?: string
  options?: string[]
  mcp?: string  // MCP server required when this arg has a value
}

export interface RepoEntry {
  name: string
  url: string
}

export interface AgentInstance {
  index: number
  id: string
  tag?: string
  workingDir: string
  createdAt: string
  ready: boolean
}

export interface AgentSession {
  id: string
  agentId: string
  instanceId: string
  instanceIndex: number
  instanceTag?: string
  agentName: string
  status: string
  startedAt: string
  args: Record<string, string>
  workingDir: string
}

export interface AgentDefinition {
  id: string
  name: string
  emoji: string
  description: string
  useWhen: string
  claudeMdPath: string
  claudeMdContent: string
  settingsPath?: string
  settings: Record<string, unknown>
  allowedCommands: string[]
  args: AgentArg[]
  mcpRequirements: string[]
  repos: RepoEntry[]
  workingDir: string
  instances: AgentInstance[]
  marketplaceAgentId?: string
}

const SWARM_DIR = join(homedir(), '.swarm')
const AGENTS_DIR = join(SWARM_DIR, 'agents')
const BASE_CLAUDE_MD_PATH = join(SWARM_DIR, 'CLAUDE.md')

const sessions = new Map<string, AgentSession>()

const DEFAULT_BASE_CLAUDE_MD = `# Swarm — Base Agent Rules

## Workspace Boundaries

- You are running inside a Swarm agent workspace.
- **Only read and write files within your own working directory.** Do not access, modify, or reference files outside of it unless the agent instructions explicitly grant access to specific external paths.
- Treat your working directory as the root of your world.

## Autonomy

- Follow the agent-specific instructions (below) precisely.
- If the instructions define a workflow, execute it step by step without asking for confirmation unless the instructions say otherwise.
- If you need user input that the instructions say to ask for, ask concisely.

## Output

- Be concise. Lead with results, not process.
- When referencing files, use paths relative to your working directory.

## MCP Requirements

- If the agent instructions list required MCP servers (e.g. Linear, Slack), check that they are connected before proceeding.
- If a required MCP server is not available, **stop immediately** and tell the user which MCP server(s) are missing. Do not attempt to work around missing MCP connections.

## Commands

- Run each shell command as a single, standalone command. Never chain commands with \`&&\`, \`;\`, or \`|\` unless the agent instructions explicitly require it.
- To run a command inside a repo directory, use the \`-C\` flag (e.g. \`git -C ./repo-name checkout branch\`) or set the working directory explicitly — do not use \`cd /path && command\`.

## Safety

- Never run destructive commands (rm -rf, git push --force, DROP TABLE, etc.) unless the agent instructions explicitly permit it.
- Never install global packages or modify system configuration.
- Never access secrets, credentials, or .env files unless the agent instructions require it and the user has granted permission.

---

`

async function ensureBaseDirs(): Promise<void> {
  await mkdir(AGENTS_DIR, { recursive: true })
  try {
    await readFile(BASE_CLAUDE_MD_PATH, 'utf-8')
  } catch {
    await writeFile(BASE_CLAUDE_MD_PATH, DEFAULT_BASE_CLAUDE_MD, 'utf-8')
  }
}

// Name is uniquely indexed per-user in the DB, so folder collisions are impossible
// for valid names. Strip filesystem-hostile chars as a safety net.
function sanitizeFolderName(name: string): string {
  const s = (name || '').trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^[.-]+|[.-]+$/g, '')
  return s || 'agent'
}

function agentDirFor(name: string): string {
  return join(AGENTS_DIR, sanitizeFolderName(name))
}

/**
 * Write CLAUDE.md + (optionally) settings.local.json INTO an instance's
 * working directory. Claude Code v2 does not reliably walk parent directories
 * for CLAUDE.md, so we materialize the agent definition directly in the cwd
 * where claude is spawned. Diff-aware — no write if disk already matches.
 */
async function materializeInstanceFiles(
  workingDir: string,
  claudeMdContent: string,
  allowedCommands: string[]
): Promise<void> {
  await mkdir(workingDir, { recursive: true })
  // Prepend base rules so each session sees them too (Claude Code won't walk
  // up to ~/.swarm/CLAUDE.md on its own).
  let baseRules = DEFAULT_BASE_CLAUDE_MD
  try {
    baseRules = await readFile(BASE_CLAUDE_MD_PATH, 'utf-8')
  } catch { /* fall back to default */ }
  const combined = `${baseRules.trimEnd()}\n\n${claudeMdContent}`
  const claudeMdPath = join(workingDir, 'CLAUDE.md')
  let existing = ''
  try { existing = await readFile(claudeMdPath, 'utf-8') } catch { /* not on disk yet */ }
  if (existing !== combined) {
    await writeFile(claudeMdPath, combined, 'utf-8')
  }
  if (allowedCommands.length > 0) {
    await writeSettings(workingDir, allowedCommands)
  }
}

/**
 * Write CLAUDE.md and settings at the agent-level dir AND propagate to every
 * existing instance directory. Used by the marketplace edit path so wiki
 * updates reach already-created instances.
 */
export async function syncAgentDiskFiles(
  agentId: string,
  claudeMdContent: string,
  allowedCommands: string[]
): Promise<void> {
  const row = await repoGetAgent(agentId)
  const agentDir = agentDirFor((row.name as string) || '')
  await mkdir(agentDir, { recursive: true })
  await writeFile(join(agentDir, 'CLAUDE.md'), claudeMdContent, 'utf-8')
  await writeSettings(agentDir, allowedCommands)

  const instanceRows = await repoGetInstances(agentId)
  for (const inst of instanceRows) {
    await materializeInstanceFiles(
      inst.working_dir as string,
      claudeMdContent,
      allowedCommands
    )
  }
}

/**
 * Writes DB content to the agent's folder on disk if it differs, AND propagates
 * to each instance's working dir so Claude Code v2 picks up the definition.
 * Called on every agent fetch so direct-DB edits reach the filesystem.
 */
async function syncAgentToDisk(row: Record<string, unknown>): Promise<void> {
  const name = (row.name as string) || ''
  if (!name) return

  const agentDir = agentDirFor(name)
  await mkdir(agentDir, { recursive: true })

  const claudeMdPath = join(agentDir, 'CLAUDE.md')
  const content = (row.claude_md_content as string) || ''
  let existing = ''
  try { existing = await readFile(claudeMdPath, 'utf-8') } catch { /* not on disk yet */ }
  if (existing !== content) {
    await writeFile(claudeMdPath, content, 'utf-8')
  }

  const allowedCommands = (row.allowed_commands as string[]) || []
  if (allowedCommands.length > 0) {
    const settingsDir = join(agentDir, '.claude')
    const settingsPath = join(settingsDir, 'settings.local.json')
    const settingsContent = JSON.stringify({ permissions: { allow: allowedCommands } }, null, 2)
    let existingSettings = ''
    try { existingSettings = await readFile(settingsPath, 'utf-8') } catch { /* not on disk yet */ }
    if (existingSettings !== settingsContent) {
      await mkdir(settingsDir, { recursive: true })
      await writeFile(settingsPath, settingsContent, 'utf-8')
    }
  }

  // Claude Code v2 doesn't walk up for CLAUDE.md — materialize into every instance dir too
  const agentId = row.id as string
  if (agentId) {
    try {
      const instanceRows = await repoGetInstances(agentId)
      for (const inst of instanceRows) {
        await materializeInstanceFiles(inst.working_dir as string, content, allowedCommands)
      }
    } catch (err) {
      console.error('[agent-manager] syncAgentToDisk: instance propagation failed:', err)
    }
  }
}

// ─── DB row → app type mappers ──────────────────────────────────────────────

function dbRowToAgentDefinition(
  row: Record<string, unknown>,
  instances: AgentInstance[]
): AgentDefinition {
  const id = row.id as string
  const name = (row.name as string) || ''
  const agentDir = agentDirFor(name)
  const claudeMdPath = join(agentDir, 'CLAUDE.md')
  const settingsPath = join(agentDir, '.claude', 'settings.local.json')
  const allowedCommands = (row.allowed_commands as string[]) || []

  return {
    id,
    name,
    emoji: (row.emoji as string) || '🤖',
    description: (row.description as string) || '',
    useWhen: (row.use_when as string) || '',
    claudeMdPath,
    claudeMdContent: (row.claude_md_content as string) || '',
    settingsPath: allowedCommands.length > 0 ? settingsPath : undefined,
    settings: allowedCommands.length > 0 ? { permissions: { allow: allowedCommands } } : {},
    allowedCommands,
    args: (row.args as AgentArg[]) || [],
    mcpRequirements: (row.mcp_requirements as string[]) || [],
    repos: (row.repos as RepoEntry[]) || [],
    workingDir: agentDir,
    instances,
    marketplaceAgentId: (row.marketplace_agent_id as string | null) ?? undefined
  }
}

function dbRowToInstance(row: Record<string, unknown>): AgentInstance {
  return {
    index: row.index as number,
    id: row.id as string,
    tag: row.tag as string | undefined,
    workingDir: row.working_dir as string,
    createdAt: row.created_at as string,
    ready: row.ready as boolean
  }
}

// ─── clone helpers ────────────────────────────────────────────────────────────

function broadcastCloneProgress(
  instanceId: string,
  repo: string,
  status: 'cloning' | 'done' | 'error',
  error?: string
): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('agent:cloneProgress', { instanceId, repo, status, error })
  }
}

function broadcastInstanceReady(agentId: string, instanceId: string): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('instance:ready', { agentId, instanceId })
  }
}

function cloneRepo(destDir: string, repoName: string, repoUrl: string, instanceId: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const repoDir = join(destDir, repoName)

    try {
      const fs = require('fs')
      if (fs.statSync(repoDir).isDirectory()) {
        broadcastCloneProgress(instanceId, repoName, 'done')
        resolve()
        return
      }
    } catch {
      // Not cloned yet
    }

    const url = repoUrl
    broadcastCloneProgress(instanceId, repoName, 'cloning')
    console.log(`[agent-manager] cloning ${repoName} into ${destDir}`)

    const proc = spawn('git', ['clone', '--progress', url, repoDir], {
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }
    })

    let stderrBuf = ''
    proc.stdout?.on('data', () => {})
    proc.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString()
      stderrBuf += text
      console.log(`[git clone ${repoName}] ${text.trimEnd()}`)
    })

    proc.on('close', (code) => {
      if (code === 0) {
        broadcastCloneProgress(instanceId, repoName, 'done')
        resolve()
      } else {
        const msg = `git clone exited with code ${code}: ${stderrBuf.trim().split('\n').pop() || ''}`
        broadcastCloneProgress(instanceId, repoName, 'error', msg)
        reject(new Error(msg))
      }
    })

    proc.on('error', (err) => {
      broadcastCloneProgress(instanceId, repoName, 'error', err.message)
      reject(err)
    })
  })
}

// ─── one-shot migration: UUID-named folders → name-based folders ────────────

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function migrateAgentFolders(): Promise<void> {
  await ensureBaseDirs()

  let entries: import('fs').Dirent[] = []
  try {
    entries = await readdir(AGENTS_DIR, { withFileTypes: true })
  } catch {
    return
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    if (!UUID_RE.test(entry.name)) continue

    const agentId = entry.name
    let row: Record<string, unknown> | null = null
    try {
      row = await repoGetAgent(agentId)
    } catch {
      console.warn(`[migrate] no DB row for folder ${agentId}; leaving as-is`)
      continue
    }
    if (!row) continue

    const name = (row.name as string) || ''
    if (!name) continue

    const oldDir = join(AGENTS_DIR, agentId)
    const newDir = agentDirFor(name)

    try {
      await stat(newDir)
      console.warn(`[migrate] target ${newDir} already exists; skipping ${agentId}`)
      continue
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.error(`[migrate] stat failed for ${newDir}:`, err)
        continue
      }
    }

    try {
      await rename(oldDir, newDir)
      console.log(`[migrate] renamed ${agentId} → ${name}`)
    } catch (err) {
      console.error(`[migrate] rename failed for ${agentId}:`, err)
      continue
    }

    // Update each instance's stored working_dir so open-terminal / cron still point correctly
    try {
      const instances = await repoGetInstances(agentId)
      for (const inst of instances) {
        const oldWd = inst.working_dir as string
        if (oldWd.startsWith(oldDir)) {
          const newWd = newDir + oldWd.slice(oldDir.length)
          await repoUpdateInstance(inst.id as string, { workingDir: newWd })
        }
      }
    } catch (err) {
      console.error(`[migrate] updating instance working_dirs failed for ${agentId}:`, err)
    }

    // Regenerate cron plists with the new path
    try {
      await reinstallCrons(agentId)
    } catch (err) {
      console.error(`[migrate] reinstallCrons failed for ${agentId}:`, err)
    }
  }
}

// ─── agent loader (from Supabase) ────────────────────────────────────────────

export async function listAgents(): Promise<AgentDefinition[]> {
  await ensureBaseDirs()
  const rows = await repoGetAgents()
  const agents: AgentDefinition[] = []

  for (const row of rows) {
    await syncAgentToDisk(row)
    const instanceRows = await repoGetInstances(row.id as string)
    const instances = instanceRows.map(dbRowToInstance)
    agents.push(dbRowToAgentDefinition(row, instances))
  }

  return agents
}

export async function getAgent(agentId: string): Promise<AgentDefinition | null> {
  try {
    const row = await repoGetAgent(agentId)
    await syncAgentToDisk(row)
    const instanceRows = await repoGetInstances(agentId)
    const instances = instanceRows.map(dbRowToInstance)
    return dbRowToAgentDefinition(row, instances)
  } catch {
    return null
  }
}

// ─── instance management ─────────────────────────────────────────────────────

export async function createInstance(agentId: string): Promise<AgentInstance> {
  const agent = await getAgent(agentId)
  if (!agent) throw new Error(`Agent not found: ${agentId}`)

  const existingRows = await repoGetInstances(agentId)
  const index = existingRows.length > 0
    ? Math.max(...existingRows.map((r) => r.index as number)) + 1
    : 1

  const agentDir = agentDirFor(agent.name)
  const workingDir = join(agentDir, 'instances', String(index))
  await mkdir(workingDir, { recursive: true })

  await materializeInstanceFiles(workingDir, agent.claudeMdContent, agent.allowedCommands)

  const ready = agent.repos.length === 0
  const dbRow = await repoCreateInstance({
    agentId,
    index,
    workingDir,
    ready
  })

  const instance = dbRowToInstance(dbRow)

  if (agent.repos.length > 0) {
    const dbInstanceId = instance.id
    ;(async () => {
      try {
        for (const repo of agent.repos) {
          await cloneRepo(workingDir, repo.name, repo.url, dbInstanceId)
        }
        await repoUpdateInstance(dbInstanceId, { ready: true })
        broadcastInstanceReady(agentId, dbInstanceId)
      } catch (err) {
        console.error(`[agent-manager] cloning failed for instance ${dbInstanceId}:`, err)
      }
    })()
  }

  return instance
}

export async function deleteInstance(agentId: string, instanceId: string): Promise<void> {
  try {
    const { rm } = await import('fs/promises')
    const rows = await repoGetInstances(agentId)
    const row = rows.find((r) => (r.id as string) === instanceId)
    if (row) {
      await rm(row.working_dir as string, { recursive: true, force: true })
    }
  } catch {
    // Directory may not exist
  }
  await repoDeleteInstance(instanceId)
}

export async function updateInstanceTag(agentId: string, instanceId: string, tag: string): Promise<void> {
  await repoUpdateInstance(instanceId, { tag: tag || undefined })
}

// ─── Claude session ID detection ─────────────────────────────────────────────

function getClaudeProjectDir(workingDir: string): string {
  const encoded = workingDir.replace(/\//g, '-')
  return join(homedir(), '.claude', 'projects', encoded)
}

async function findClaudeSessionId(workingDir: string): Promise<string | null> {
  const projectDir = getClaudeProjectDir(workingDir)
  try {
    const { stat } = await import('fs/promises')
    const files = await readdir(projectDir)
    let newestTime = 0
    let newestUuid: string | null = null
    for (const file of files) {
      if (!file.endsWith('.jsonl')) continue
      try {
        const s = await stat(join(projectDir, file))
        if (s.mtimeMs > newestTime) {
          newestTime = s.mtimeMs
          newestUuid = file.slice(0, -6)
        }
      } catch { /* skip */ }
    }
    return newestUuid
  } catch {
    return null
  }
}

function broadcastSessionClaudeId(sessionId: string, claudeSessionId: string): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('session:claudeId', { sessionId, claudeSessionId })
  }
}

// ─── session management ───────────────────────────────────────────────────────

export async function spawnAgent(
  agentId: string,
  instanceId: string,
  args: Record<string, string>
): Promise<AgentSession> {
  const agent = await getAgent(agentId)
  if (!agent) throw new Error(`Agent not found: ${agentId}`)

  const instance = agent.instances.find((i) => i.id === instanceId)
  if (!instance) throw new Error(`Instance not found: ${instanceId}`)
  if (!instance.ready) throw new Error(`Instance ${instanceId} is not ready yet`)

  // Defensive: ensure CLAUDE.md (and settings) exist in the instance cwd
  // before Claude Code launches. Fixes any legacy instances created before
  // materializeInstanceFiles existed.
  await materializeInstanceFiles(instance.workingDir, agent.claudeMdContent, agent.allowedCommands)

  const sessionId = uuid()
  const startedAt = new Date().toISOString()

  const prompt = Object.keys(args).length > 0
    ? Object.entries(args).map(([k, v]) => `${k}: ${v}`).join(' | ')
    : ''

  const logDir = join(instance.workingDir, 'sessions')

  const session: AgentSession = {
    id: sessionId,
    agentId,
    instanceId,
    instanceIndex: instance.index,
    instanceTag: instance.tag,
    agentName: agent.name,
    status: 'idle',
    startedAt,
    args,
    workingDir: instance.workingDir
  }

  sessions.set(sessionId, session)

  await addSessionRecord({
    id: sessionId,
    agentId,
    agentName: agent.name,
    instanceId,
    instanceIndex: instance.index,
    instanceTag: instance.tag,
    startedAt,
    prompt,
    logDir,
    marketplaceAgentId: agent.marketplaceAgentId
  })

  const lockFile = join(logDir, '.lock')
  await mkdir(logDir, { recursive: true })
  await writeFile(lockFile, sessionId, 'utf-8')

  console.log(`[agent-manager] spawning claude in ${instance.workingDir}, prompt: "${prompt}"`)
  spawnPty(sessionId, instance.workingDir, 'claude', [], prompt || undefined, logDir, () => {
    import('fs/promises').then(({ unlink }) => unlink(lockFile).catch(() => {}))
  })

  return session
}

export async function resumeAgent(
  agentId: string,
  instanceId: string,
  claudeSessionId: string
): Promise<AgentSession> {
  const agent = await getAgent(agentId)
  if (!agent) throw new Error(`Agent not found: ${agentId}`)

  const instance = agent.instances.find((i) => i.id === instanceId)
  if (!instance) throw new Error(`Instance not found: ${instanceId}`)
  if (!instance.ready) throw new Error(`Instance ${instanceId} is not ready yet`)

  await materializeInstanceFiles(instance.workingDir, agent.claudeMdContent, agent.allowedCommands)

  const sessionId = uuid()
  const startedAt = new Date().toISOString()
  const logDir = join(instance.workingDir, 'sessions')

  const session: AgentSession = {
    id: sessionId,
    agentId,
    instanceId,
    instanceIndex: instance.index,
    instanceTag: instance.tag,
    agentName: agent.name,
    status: 'idle',
    startedAt,
    args: {},
    workingDir: instance.workingDir
  }

  sessions.set(sessionId, session)

  await addSessionRecord({
    id: sessionId,
    agentId,
    agentName: agent.name,
    instanceId,
    instanceIndex: instance.index,
    instanceTag: instance.tag,
    startedAt,
    prompt: `Resume ${claudeSessionId}`,
    logDir,
    marketplaceAgentId: agent.marketplaceAgentId
  })

  const lockFile = join(logDir, '.lock')
  await mkdir(logDir, { recursive: true })
  await writeFile(lockFile, sessionId, 'utf-8')

  spawnPty(sessionId, instance.workingDir, 'claude', ['--resume', claudeSessionId], undefined, logDir, () => {
    import('fs/promises').then(({ unlink }) => unlink(lockFile).catch(() => {}))
  })

  return session
}

export function listSessions(): AgentSession[] {
  return Array.from(sessions.values())
}

export function getSession(sessionId: string): AgentSession | null {
  return sessions.get(sessionId) || null
}

export function updateSessionStatus(sessionId: string, status: string): void {
  const session = sessions.get(sessionId)
  if (session) session.status = status
}

export function removeSession(sessionId: string): void {
  const session = sessions.get(sessionId)
  sessions.delete(sessionId)
  if (!session) return

  const lockFile = join(session.workingDir, 'sessions', '.lock')
  import('fs/promises').then(({ unlink }) => unlink(lockFile).catch(() => {}))

  const endedAt = new Date().toISOString()
  const durationMs = Date.now() - new Date(session.startedAt).getTime()
  closeSessionRecord(sessionId, endedAt, durationMs).catch(() => {})

  const workingDir = session.workingDir
  setTimeout(async () => {
    const claudeSessionId = await findClaudeSessionId(workingDir)
    if (claudeSessionId) {
      await updateSessionClaudeId(sessionId, claudeSessionId)
      broadcastSessionClaudeId(sessionId, claudeSessionId)
    }
  }, 1000)
}

// ─── agent CRUD ───────────────────────────────────────────────────────────────

export interface CreateAgentInput {
  name: string
  emoji: string
  description: string
  useWhen: string
  claudeMdBody: string
  args: AgentArg[]
  mcpRequirements: string[]
  repos: RepoEntry[]
  allowedCommands: string[]
  marketplaceAgentId?: string
}

/**
 * Derive folder names from repo URLs.
 * If two repos share the same base name, prefix with org to disambiguate.
 */
function deriveRepoNames(repos: RepoEntry[]): RepoEntry[] {
  // Parse org and repo name from each URL
  const parsed = repos.map((r) => {
    // Match patterns like github.com/org/repo.git or github.com:org/repo.git
    const match = r.url.match(/[/:]([^/]+)\/([^/]+?)(?:\.git)?\s*$/)
    const org = match ? match[1] : ''
    const base = match ? match[2] : r.url.split('/').pop()?.replace(/\.git$/, '') || r.url
    return { ...r, org, base }
  })

  // Find duplicate base names
  const baseCounts = new Map<string, number>()
  for (const p of parsed) {
    baseCounts.set(p.base, (baseCounts.get(p.base) || 0) + 1)
  }

  return parsed.map((p) => ({
    name: (baseCounts.get(p.base) || 0) > 1 && p.org ? `${p.org}-${p.base}` : p.base,
    url: p.url
  }))
}

function buildFrontmatter(input: CreateAgentInput): Record<string, unknown> {
  const frontmatter: Record<string, unknown> = {
    name: input.name,
    description: input.description
  }
  if (input.emoji) frontmatter.emoji = input.emoji
  if (input.useWhen) frontmatter.useWhen = input.useWhen
  if (input.args.length > 0) frontmatter.args = input.args
  if (input.mcpRequirements.length > 0) frontmatter.mcp = input.mcpRequirements
  if (input.repos.length > 0) frontmatter.repos = input.repos
  return frontmatter
}

async function buildClaudeMd(input: CreateAgentInput): Promise<string> {
  const frontmatter = buildFrontmatter(input)

  let reposSection = ''
  if (input.repos.length > 0) {
    reposSection = `\n## Repos\n\n`
    for (const repo of input.repos) {
      reposSection += `- **${repo.name}:** \`./${repo.name}\`\n`
    }
    reposSection += `\nThese repos are cloned in your working directory. Reference them using the relative paths above.\n\n`
  }

  return `---\n${stringifyYaml(frontmatter).trim()}\n---\n${reposSection}# Agent Instructions\n\n${input.claudeMdBody}`
}

async function writeSettings(agentDir: string, allowedCommands: string[]): Promise<void> {
  if (allowedCommands.length === 0) return
  const settingsDir = join(agentDir, '.claude')
  await mkdir(settingsDir, { recursive: true })
  await writeFile(
    join(settingsDir, 'settings.local.json'),
    JSON.stringify({ permissions: { allow: allowedCommands } }, null, 2),
    'utf-8'
  )
}

export async function createAgent(input: CreateAgentInput): Promise<AgentDefinition> {
  console.log('[agent-manager] createAgent called')
  await ensureBaseDirs()

  input.repos = deriveRepoNames(input.repos)

  const claudeMdContent = await buildClaudeMd(input)

  // Store metadata in Supabase
  const dbRow = await repoCreateAgent({
    name: input.name,
    emoji: input.emoji,
    description: input.description,
    useWhen: input.useWhen,
    claudeMdContent,
    args: input.args,
    mcpRequirements: input.mcpRequirements,
    allowedCommands: input.allowedCommands,
    repos: input.repos,
    marketplaceAgentId: input.marketplaceAgentId
  })

  const agentId = dbRow.id as string
  const agentDir = agentDirFor(input.name)
  await mkdir(agentDir, { recursive: true })

  // Write to disk for Claude Code
  await writeFile(join(agentDir, 'CLAUDE.md'), claudeMdContent, 'utf-8')
  await writeSettings(agentDir, input.allowedCommands)

  // Auto-create first instance
  await createInstance(agentId)

  return (await getAgent(agentId))!
}

export async function updateAgent(agentId: string, input: CreateAgentInput): Promise<AgentDefinition> {
  input.repos = deriveRepoNames(input.repos)

  const claudeMdContent = await buildClaudeMd(input)

  // Detect rename before we mutate anything
  const currentRow = await repoGetAgent(agentId)
  const currentName = (currentRow.name as string) || ''
  const oldDir = agentDirFor(currentName)
  const newDir = agentDirFor(input.name)
  const isRename = oldDir !== newDir

  if (isRename) {
    // Refuse to clobber an unrelated folder already sitting at the target path
    try {
      await stat(newDir)
      throw new Error(`Cannot rename agent to "${input.name}": folder ${newDir} already exists`)
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
    }
    try {
      await rename(oldDir, newDir)
    } catch (err) {
      // Source may not exist yet (first-time write); fall through to mkdir below
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
    }
  }

  // Update metadata in Supabase
  await repoUpdateAgent(agentId, {
    name: input.name,
    emoji: input.emoji,
    description: input.description,
    useWhen: input.useWhen,
    claudeMdContent,
    args: input.args,
    mcpRequirements: input.mcpRequirements,
    allowedCommands: input.allowedCommands,
    repos: input.repos
  })

  await mkdir(newDir, { recursive: true })

  // Update disk files for Claude Code
  await writeFile(join(newDir, 'CLAUDE.md'), claudeMdContent, 'utf-8')
  await writeSettings(newDir, input.allowedCommands)

  // If the agent folder was renamed, rewrite every instance's stored working_dir
  // in the DB so open-terminal / cron / file-browser keep pointing at the right path.
  // Then propagate the updated CLAUDE.md + permissions into each instance dir so
  // already-created instances pick up the new definition (Claude Code v2 doesn't walk up).
  const instanceRows = await repoGetInstances(agentId)
  for (const inst of instanceRows) {
    const oldWd = inst.working_dir as string
    let newWd = oldWd
    if (isRename && oldWd.startsWith(oldDir)) {
      newWd = newDir + oldWd.slice(oldDir.length)
      await repoUpdateInstance(inst.id as string, { workingDir: newWd })
    }
    await materializeInstanceFiles(newWd, claudeMdContent, input.allowedCommands)
  }

  // Cron plists bake the instance dir into the plist XML — regenerate on rename
  if (isRename) {
    try {
      await reinstallCrons(agentId)
    } catch (err) {
      console.error('[agent-manager] reinstallCrons failed after rename:', err)
    }
  }

  return (await getAgent(agentId))!
}

export async function deleteAgent(agentId: string): Promise<void> {
  await deleteAllCrons(agentId)

  let name = ''
  try {
    const row = await repoGetAgent(agentId)
    name = (row.name as string) || ''
  } catch { /* already gone */ }

  // Delete from Supabase (cascades to instances, sessions, crons)
  await repoDeleteAgent(agentId)

  // Clean up disk
  if (name) {
    const agentDir = agentDirFor(name)
    const { rm } = await import('fs/promises')
    await rm(agentDir, { recursive: true, force: true })
  }
}

