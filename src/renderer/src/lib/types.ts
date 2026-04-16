export interface AgentArg {
  name: string
  description: string
  required: boolean
  default?: string
  options?: string[]
}

// Persistent workspace folder
export interface AgentInstance {
  index: number
  id: string
  tag?: string
  workingDir: string
  createdAt: string
  ready: boolean
}

export interface RepoEntry {
  name: string
  url: string
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
  args: AgentArg[]
  mcpRequirements: string[]
  allowedCommands: string[]
  repos: RepoEntry[]
  workingDir: string
  instances: AgentInstance[]
}

export type InstanceStatus = 'idle' | 'thinking' | 'waiting' | 'error'

// Active terminal session (in-memory)
export interface AgentSession {
  id: string
  agentId: string
  instanceId: string
  instanceIndex: number
  instanceTag?: string
  agentName: string
  status: InstanceStatus
  startedAt: string
  args: Record<string, string>
  workingDir: string
}

export interface SessionRecord {
  id: string
  agentId: string
  agentName: string
  instanceId: string
  instanceIndex: number
  instanceTag?: string
  startedAt: string
  endedAt?: string
  durationMs?: number
  prompt: string
  logDir: string
  claudeSessionId?: string
}

export type McpStatus = 'connected' | 'needs-auth' | 'never-connected'

export interface McpStatusResult {
  name: string
  fullName: string
  status: McpStatus
}

export interface FileEntry {
  name: string
  path: string
  isDirectory: boolean
  size: number
}

export interface CronSchedule {
  minute?: number
  hour?: number
  weekday?: number
  day?: number
  month?: number
}

export interface CronDefinition {
  id: string
  label: string
  schedule: CronSchedule
  args: Record<string, string>
  enabled: boolean
  createdAt: string
}
