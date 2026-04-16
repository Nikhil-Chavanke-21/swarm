import { readdir, readFile, mkdir, writeFile } from 'fs/promises'
import { v4 as uuid } from 'uuid'
import { join } from 'path'
import { homedir } from 'os'
import { stringify as stringifyYaml } from 'yaml'
import { spawn } from 'child_process'
import { BrowserWindow } from 'electron'
import { spawnPty } from './pty-manager'
import { addSessionRecord, closeSessionRecord, updateSessionClaudeId } from './session-manager'
import { deleteAllCrons } from './cron-manager'
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
}

export const AVAILABLE_REPOS = {
  'sales-backend': 'https://github.com/REGIE-io/sales-backend.git',
  'regie-client-new': 'https://github.com/REGIE-io/regie-client-new.git'
} as const

export type RepoId = keyof typeof AVAILABLE_REPOS

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
  repos: RepoId[]
  workingDir: string
  instances: AgentInstance[]
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

// ─── DB row → app type mappers ──────────────────────────────────────────────

function dbRowToAgentDefinition(
  row: Record<string, unknown>,
  instances: AgentInstance[]
): AgentDefinition {
  const id = row.id as string
  const agentDir = join(AGENTS_DIR, id)
  const claudeMdPath = join(agentDir, 'CLAUDE.md')
  const settingsPath = join(agentDir, '.claude', 'settings.local.json')
  const allowedCommands = (row.allowed_commands as string[]) || []

  return {
    id,
    name: (row.name as string) || '',
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
    repos: (row.repos as RepoId[]) || [],
    workingDir: agentDir,
    instances
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

function cloneRepo(destDir: string, repo: RepoId, instanceId: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const repoDir = join(destDir, repo)

    try {
      const fs = require('fs')
      if (fs.statSync(repoDir).isDirectory()) {
        broadcastCloneProgress(instanceId, repo, 'done')
        resolve()
        return
      }
    } catch {
      // Not cloned yet
    }

    const url = AVAILABLE_REPOS[repo]
    broadcastCloneProgress(instanceId, repo, 'cloning')
    console.log(`[agent-manager] cloning ${repo} into ${destDir}`)

    const proc = spawn('git', ['clone', url, repoDir])

    proc.on('close', (code) => {
      if (code === 0) {
        broadcastCloneProgress(instanceId, repo, 'done')
        resolve()
      } else {
        const msg = `git clone exited with code ${code}`
        broadcastCloneProgress(instanceId, repo, 'error', msg)
        reject(new Error(msg))
      }
    })

    proc.on('error', (err) => {
      broadcastCloneProgress(instanceId, repo, 'error', err.message)
      reject(err)
    })
  })
}

// ─── agent loader (from Supabase) ────────────────────────────────────────────

export async function listAgents(): Promise<AgentDefinition[]> {
  await ensureBaseDirs()
  const rows = await repoGetAgents()
  const agents: AgentDefinition[] = []

  for (const row of rows) {
    const instanceRows = await repoGetInstances(row.id as string)
    const instances = instanceRows.map(dbRowToInstance)
    agents.push(dbRowToAgentDefinition(row, instances))
  }

  return agents
}

export async function getAgent(agentId: string): Promise<AgentDefinition | null> {
  try {
    const row = await repoGetAgent(agentId)
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

  const agentDir = join(AGENTS_DIR, agentId)
  const workingDir = join(agentDir, 'instances', String(index))
  await mkdir(workingDir, { recursive: true })

  if (agent.allowedCommands.length > 0) {
    await writeSettings(workingDir, agent.allowedCommands)
  }

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
          await cloneRepo(workingDir, repo, dbInstanceId)
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
    logDir
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
    logDir
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
  repos: RepoId[]
  allowedCommands: string[]
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
      reposSection += `- **${repo}:** \`./${repo}\`\n`
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
    repos: input.repos
  })

  const agentId = dbRow.id as string
  const agentDir = join(AGENTS_DIR, agentId)
  await mkdir(agentDir, { recursive: true })

  // Write to disk for Claude Code
  await writeFile(join(agentDir, 'CLAUDE.md'), claudeMdContent, 'utf-8')
  await writeSettings(agentDir, input.allowedCommands)

  // Auto-create first instance
  await createInstance(agentId)

  return (await getAgent(agentId))!
}

export async function updateAgent(agentId: string, input: CreateAgentInput): Promise<AgentDefinition> {
  const claudeMdContent = await buildClaudeMd(input)

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

  const agentDir = join(AGENTS_DIR, agentId)
  await mkdir(agentDir, { recursive: true })

  // Update disk files for Claude Code
  await writeFile(join(agentDir, 'CLAUDE.md'), claudeMdContent, 'utf-8')
  await writeSettings(agentDir, input.allowedCommands)

  // Propagate updated permissions to all existing instance folders
  if (input.allowedCommands.length > 0) {
    const instanceRows = await repoGetInstances(agentId)
    for (const inst of instanceRows) {
      await writeSettings(inst.working_dir as string, input.allowedCommands)
    }
  }

  return (await getAgent(agentId))!
}

export async function deleteAgent(agentId: string): Promise<void> {
  await deleteAllCrons(agentId)

  // Delete from Supabase (cascades to instances, sessions, crons)
  await repoDeleteAgent(agentId)

  // Clean up disk
  const agentDir = join(AGENTS_DIR, agentId)
  const { rm } = await import('fs/promises')
  await rm(agentDir, { recursive: true, force: true })
}

export function getAvailableRepos(): Record<string, string> {
  return { ...AVAILABLE_REPOS }
}
