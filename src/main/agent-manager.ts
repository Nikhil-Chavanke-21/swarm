import { readdir, readFile, mkdir, writeFile } from 'fs/promises'
import { v4 as uuid } from 'uuid'
import { join } from 'path'
import { homedir } from 'os'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import { spawn } from 'child_process'
import { BrowserWindow } from 'electron'
import { spawnPty } from './pty-manager'
import { addSessionRecord, closeSessionRecord, updateSessionClaudeId } from './session-manager'
import { deleteAllCrons } from './cron-manager'

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

// Persistent workspace folder for an agent
export interface AgentInstance {
  index: number
  id: string
  tag?: string
  workingDir: string
  createdAt: string
  ready: boolean  // false while repos are being cloned
}

// Active terminal session (in-memory only)
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

// In-memory active sessions
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

async function ensureDirs(): Promise<void> {
  await mkdir(AGENTS_DIR, { recursive: true })
  try {
    await readFile(BASE_CLAUDE_MD_PATH, 'utf-8')
  } catch {
    await writeFile(BASE_CLAUDE_MD_PATH, DEFAULT_BASE_CLAUDE_MD, 'utf-8')
  }

  // Seed the base claude agent on first launch
  const baseAgentDir = join(AGENTS_DIR, 'claude')
  try {
    await readFile(join(baseAgentDir, 'CLAUDE.md'), 'utf-8')
  } catch {
    await mkdir(baseAgentDir, { recursive: true })
    await writeFile(join(baseAgentDir, 'CLAUDE.md'),
      `---\nname: claude\ndescription: A plain Claude Code session with no configuration.\n---\n`,
      'utf-8'
    )
    // Create instance 1
    const instanceDir = join(baseAgentDir, 'instances', '1')
    await mkdir(instanceDir, { recursive: true })
    await writeFile(
      join(baseAgentDir, 'instances.json'),
      JSON.stringify([{ index: 1, id: '1', workingDir: instanceDir, createdAt: new Date().toISOString(), ready: true }], null, 2),
      'utf-8'
    )
  }
}

function parseFrontmatter(content: string): { frontmatter: Record<string, unknown>; body: string } {
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/)
  if (!match) return { frontmatter: {}, body: content }
  try {
    const frontmatter = parseYaml(match[1]) as Record<string, unknown>
    return { frontmatter, body: match[2] }
  } catch {
    return { frontmatter: {}, body: content }
  }
}

// ─── instances.json helpers ──────────────────────────────────────────────────

function instancesFilePath(agentDir: string): string {
  return join(agentDir, 'instances.json')
}

async function loadInstancesFromDisk(agentDir: string): Promise<AgentInstance[]> {
  try {
    const raw = await readFile(instancesFilePath(agentDir), 'utf-8')
    return JSON.parse(raw) as AgentInstance[]
  } catch {
    return []
  }
}

async function saveInstancesToDisk(agentDir: string, instances: AgentInstance[]): Promise<void> {
  await writeFile(instancesFilePath(agentDir), JSON.stringify(instances, null, 2), 'utf-8')
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

// ─── agent loader ─────────────────────────────────────────────────────────────

async function loadAgent(agentDir: string): Promise<AgentDefinition | null> {
  const claudeMdPath = join(agentDir, 'CLAUDE.md')
  try {
    const content = await readFile(claudeMdPath, 'utf-8')
    const { frontmatter } = parseFrontmatter(content)
    const id = agentDir.split('/').pop() || 'unknown'

    let settings: Record<string, unknown> = {}
    const settingsPath = join(agentDir, '.claude', 'settings.local.json')
    try {
      const settingsContent = await readFile(settingsPath, 'utf-8')
      settings = JSON.parse(settingsContent)
    } catch {
      // No settings file
    }

    const args: AgentArg[] = Array.isArray(frontmatter.args) ? (frontmatter.args as AgentArg[]) : []
    const mcpRequirements: string[] = Array.isArray(frontmatter.mcp) ? (frontmatter.mcp as string[]) : []
    const repos: RepoId[] = Array.isArray(frontmatter.repos) ? (frontmatter.repos as RepoId[]) : []
    const allowedCommands: string[] = (settings as any)?.permissions?.allow || []
    const instances = await loadInstancesFromDisk(agentDir)

    return {
      id,
      name: (frontmatter.name as string) || id.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
      emoji: (frontmatter.emoji as string) || '🤖',
      description: (frontmatter.description as string) || '',
      useWhen: (frontmatter.useWhen as string) || '',
      claudeMdPath,
      claudeMdContent: content,
      settingsPath: settings ? settingsPath : undefined,
      settings,
      allowedCommands,
      args,
      mcpRequirements,
      repos,
      workingDir: agentDir,
      instances
    }
  } catch {
    return null
  }
}

export async function listAgents(): Promise<AgentDefinition[]> {
  await ensureDirs()
  const agents: AgentDefinition[] = []
  try {
    const entries = await readdir(AGENTS_DIR, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.isDirectory() && !entry.name.startsWith('.')) {
        const agent = await loadAgent(join(AGENTS_DIR, entry.name))
        if (agent) agents.push(agent)
      }
    }
  } catch {
    // Directory might not exist yet
  }
  return agents
}

export async function getAgent(agentId: string): Promise<AgentDefinition | null> {
  return loadAgent(join(AGENTS_DIR, agentId))
}

// ─── instance management ─────────────────────────────────────────────────────

export async function createInstance(agentId: string): Promise<AgentInstance> {
  const agentDir = join(AGENTS_DIR, agentId)
  const agent = await getAgent(agentId)
  if (!agent) throw new Error(`Agent not found: ${agentId}`)

  const existing = await loadInstancesFromDisk(agentDir)
  const index = existing.length > 0 ? Math.max(...existing.map((i) => parseInt(i.id))) + 1 : 1
  const id = String(index)
  const workingDir = join(agentDir, 'instances', id)

  await mkdir(workingDir, { recursive: true })

  // Copy agent permissions into the instance folder so Claude picks them up
  if (agent.allowedCommands.length > 0) {
    await writeSettings(workingDir, agent.allowedCommands)
  }

  const instance: AgentInstance = {
    index,
    id,
    workingDir,
    createdAt: new Date().toISOString(),
    ready: agent.repos.length === 0  // ready immediately if no repos to clone
  }

  await saveInstancesToDisk(agentDir, [...existing, instance])

  // Clone repos in the background — non-blocking
  if (agent.repos.length > 0) {
    ;(async () => {
      try {
        for (const repo of agent.repos) {
          await cloneRepo(workingDir, repo, id)
        }
        // Mark ready
        const latest = await loadInstancesFromDisk(agentDir)
        const updated = latest.map((i) => (i.id === id ? { ...i, ready: true } : i))
        await saveInstancesToDisk(agentDir, updated)
        broadcastInstanceReady(agentId, id)
      } catch (err) {
        console.error(`[agent-manager] cloning failed for instance ${id}:`, err)
      }
    })()
  }

  return instance
}

export async function deleteInstance(agentId: string, instanceId: string): Promise<void> {
  const agentDir = join(AGENTS_DIR, agentId)
  const instances = await loadInstancesFromDisk(agentDir)
  const instance = instances.find((i) => i.id === instanceId)
  if (!instance) return

  const { rm } = await import('fs/promises')
  await rm(instance.workingDir, { recursive: true, force: true })

  const remaining = instances.filter((i) => i.id !== instanceId)
  // Re-index
  const reindexed = remaining.map((i, idx) => ({ ...i, index: idx + 1 }))
  await saveInstancesToDisk(agentDir, reindexed)
}

export async function updateInstanceTag(agentId: string, instanceId: string, tag: string): Promise<void> {
  const agentDir = join(AGENTS_DIR, agentId)
  const instances = await loadInstancesFromDisk(agentDir)
  const updated = instances.map((i) => (i.id === instanceId ? { ...i, tag: tag || undefined } : i))
  await saveInstancesToDisk(agentDir, updated)
}

// ─── Claude session ID detection ─────────────────────────────────────────────

// Claude encodes the working dir path as the project folder name: replace all / with -
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

  // Create lock file so cron jobs know a session is running
  const lockFile = join(logDir, '.lock')
  await mkdir(logDir, { recursive: true })
  await writeFile(lockFile, sessionId, 'utf-8')

  console.log(`[agent-manager] spawning claude in ${instance.workingDir}, prompt: "${prompt}"`)
  spawnPty(sessionId, instance.workingDir, 'claude', [], prompt || undefined, logDir, () => {
    // Remove lock file when PTY exits
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

  // Create lock file so cron jobs know a session is running
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

  // Remove lock file
  const lockFile = join(session.workingDir, 'sessions', '.lock')
  import('fs/promises').then(({ unlink }) => unlink(lockFile).catch(() => {}))

  const endedAt = new Date().toISOString()
  const durationMs = Date.now() - new Date(session.startedAt).getTime()
  closeSessionRecord(sessionId, endedAt, durationMs).catch(() => {})

  // Scan for the Claude conversation ID so the session can be resumed later.
  // Small delay to let Claude finish flushing its .jsonl before we read it.
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
  await ensureDirs()

  const id = input.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  const agentDir = join(AGENTS_DIR, id)
  await mkdir(agentDir, { recursive: true })

  const claudeMdContent = await buildClaudeMd(input)
  await writeFile(join(agentDir, 'CLAUDE.md'), claudeMdContent, 'utf-8')
  await writeSettings(agentDir, input.allowedCommands)

  // Auto-create first instance (handles repo cloning)
  await createInstance(id)

  return (await loadAgent(agentDir))!
}

export async function updateAgent(agentId: string, input: CreateAgentInput): Promise<AgentDefinition> {
  const oldDir = join(AGENTS_DIR, agentId)
  const newId = input.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

  let agentDir = oldDir
  if (newId !== agentId) {
    agentDir = join(AGENTS_DIR, newId)
    const { rename } = await import('fs/promises')
    await rename(oldDir, agentDir)
  }

  const claudeMdContent = await buildClaudeMd(input)
  await writeFile(join(agentDir, 'CLAUDE.md'), claudeMdContent, 'utf-8')
  await writeSettings(agentDir, input.allowedCommands)

  // Propagate updated permissions to all existing instance folders
  if (input.allowedCommands.length > 0) {
    const instances = await loadInstancesFromDisk(agentDir)
    for (const inst of instances) {
      await writeSettings(inst.workingDir, input.allowedCommands)
    }
  }

  return (await loadAgent(agentDir))!
}

export async function deleteAgent(agentId: string): Promise<void> {
  // Clean up launchd crons before removing agent files
  await deleteAllCrons(agentId)
  const agentDir = join(AGENTS_DIR, agentId)
  const { rm } = await import('fs/promises')
  await rm(agentDir, { recursive: true, force: true })
}

export function getAvailableRepos(): Record<string, string> {
  return { ...AVAILABLE_REPOS }
}
