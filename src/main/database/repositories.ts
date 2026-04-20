import { getDatabase } from './supabase'
import { getUserId } from './user-store'

// ============================================================================
// Types
// ============================================================================

export interface AgentArg {
  name: string
  description: string
  required: boolean
  default?: string
  options?: string[]
}

export interface RepoEntry {
  name: string
  url: string
}

export interface CreateAgentInput {
  name: string
  emoji?: string
  description?: string
  useWhen?: string
  claudeMdContent?: string
  args?: AgentArg[]
  mcpRequirements?: string[]
  allowedCommands?: string[]
  repos?: RepoEntry[]
  marketplaceAgentId?: string
}

export interface UpdateAgentInput {
  name?: string
  emoji?: string
  description?: string
  useWhen?: string
  claudeMdContent?: string
  args?: AgentArg[]
  mcpRequirements?: string[]
  allowedCommands?: string[]
  repos?: RepoEntry[]
  marketplaceAgentId?: string | null
}

export interface CreateInstanceInput {
  agentId: string
  index: number
  tag?: string
  workingDir: string
  ready?: boolean
}

export interface UpdateInstanceInput {
  tag?: string
  ready?: boolean
  workingDir?: string
}

export interface CreateSessionInput {
  agentId: string
  agentName: string
  instanceId?: string
  instanceIndex?: number
  instanceTag?: string
  prompt?: string
  logDir?: string
  claudeSessionId?: string
  marketplaceAgentId?: string
}

export interface UpdateSessionInput {
  endedAt?: string
  durationMs?: number
  claudeSessionId?: string
}

export interface CronSchedule {
  minute?: number
  hour?: number
  weekday?: number
  day?: number
  month?: number
}

export interface CreateCronInput {
  agentId: string
  label: string
  schedule: CronSchedule
  args?: Record<string, string>
  enabled?: boolean
}

export interface UpdateCronInput {
  label?: string
  schedule?: CronSchedule
  args?: Record<string, string>
  enabled?: boolean
}

// ============================================================================
// User Operations
// ============================================================================

export async function ensureUser(): Promise<string> {
  const userId = getUserId()
  const db = getDatabase()

  const { error } = await db.from('users').upsert({ id: userId }, { onConflict: 'id' })

  if (error) throw error
  return userId
}

// ============================================================================
// Agent Operations
// ============================================================================

export async function getAgents() {
  const userId = getUserId()
  const { data, error } = await getDatabase()
    .from('agents')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })

  if (error) throw error
  return data
}

export async function getAgent(id: string) {
  const userId = getUserId()
  const { data, error } = await getDatabase()
    .from('agents')
    .select('*')
    .eq('id', id)
    .eq('user_id', userId)
    .single()

  if (error) throw error
  return data
}

export async function createAgent(input: CreateAgentInput) {
  const userId = getUserId()
  const { data, error } = await getDatabase()
    .from('agents')
    .insert({
      user_id: userId,
      name: input.name,
      emoji: input.emoji,
      description: input.description,
      use_when: input.useWhen,
      claude_md_content: input.claudeMdContent,
      args: input.args || [],
      mcp_requirements: input.mcpRequirements || [],
      allowed_commands: input.allowedCommands || [],
      repos: input.repos || [],
      marketplace_agent_id: input.marketplaceAgentId ?? null
    })
    .select()
    .single()

  if (error) throw error
  return data
}

export async function updateAgent(id: string, input: UpdateAgentInput) {
  const userId = getUserId()
  const updateData: Record<string, unknown> = { updated_at: new Date().toISOString() }

  if (input.name !== undefined) updateData.name = input.name
  if (input.emoji !== undefined) updateData.emoji = input.emoji
  if (input.description !== undefined) updateData.description = input.description
  if (input.useWhen !== undefined) updateData.use_when = input.useWhen
  if (input.claudeMdContent !== undefined) updateData.claude_md_content = input.claudeMdContent
  if (input.args !== undefined) updateData.args = input.args
  if (input.mcpRequirements !== undefined) updateData.mcp_requirements = input.mcpRequirements
  if (input.allowedCommands !== undefined) updateData.allowed_commands = input.allowedCommands
  if (input.repos !== undefined) updateData.repos = input.repos
  if (input.marketplaceAgentId !== undefined) updateData.marketplace_agent_id = input.marketplaceAgentId

  const { data, error } = await getDatabase()
    .from('agents')
    .update(updateData)
    .eq('id', id)
    .eq('user_id', userId)
    .select()
    .single()

  if (error) throw error
  return data
}

export async function deleteAgent(id: string) {
  const userId = getUserId()
  const { error } = await getDatabase()
    .from('agents')
    .delete()
    .eq('id', id)
    .eq('user_id', userId)

  if (error) throw error
}

// ============================================================================
// Instance Operations
// ============================================================================

export async function getInstances(agentId: string) {
  const userId = getUserId()
  const { data, error } = await getDatabase()
    .from('agent_instances')
    .select('*')
    .eq('user_id', userId)
    .eq('agent_id', agentId)
    .order('index', { ascending: true })

  if (error) throw error
  return data
}

export async function getInstance(id: string) {
  const userId = getUserId()
  const { data, error } = await getDatabase()
    .from('agent_instances')
    .select('*')
    .eq('id', id)
    .eq('user_id', userId)
    .single()

  if (error) throw error
  return data
}

export async function createInstance(input: CreateInstanceInput) {
  const userId = getUserId()
  const { data, error } = await getDatabase()
    .from('agent_instances')
    .insert({
      user_id: userId,
      agent_id: input.agentId,
      index: input.index,
      tag: input.tag,
      working_dir: input.workingDir,
      ready: input.ready ?? false
    })
    .select()
    .single()

  if (error) throw error
  return data
}

export async function updateInstance(id: string, input: UpdateInstanceInput) {
  const userId = getUserId()
  const updateData: Record<string, unknown> = {}

  if (input.tag !== undefined) updateData.tag = input.tag
  if (input.ready !== undefined) updateData.ready = input.ready
  if (input.workingDir !== undefined) updateData.working_dir = input.workingDir

  const { data, error } = await getDatabase()
    .from('agent_instances')
    .update(updateData)
    .eq('id', id)
    .eq('user_id', userId)
    .select()
    .single()

  if (error) throw error
  return data
}

export async function deleteInstance(id: string) {
  const userId = getUserId()
  const { error } = await getDatabase()
    .from('agent_instances')
    .delete()
    .eq('id', id)
    .eq('user_id', userId)

  if (error) throw error
}

// ============================================================================
// Session Operations
// ============================================================================

export async function getSessions(limit = 50) {
  const userId = getUserId()
  const { data, error } = await getDatabase()
    .from('session_records')
    .select('*')
    .eq('user_id', userId)
    .order('started_at', { ascending: false })
    .limit(limit)

  if (error) throw error
  return data
}

export async function getSessionsByAgent(agentId: string) {
  const userId = getUserId()
  const { data, error } = await getDatabase()
    .from('session_records')
    .select('*')
    .eq('user_id', userId)
    .eq('agent_id', agentId)
    .order('started_at', { ascending: false })

  if (error) throw error
  return data
}

export async function getSession(id: string) {
  const userId = getUserId()
  const { data, error } = await getDatabase()
    .from('session_records')
    .select('*')
    .eq('id', id)
    .eq('user_id', userId)
    .single()

  if (error) throw error
  return data
}

export async function createSession(input: CreateSessionInput) {
  const userId = getUserId()
  const { data, error } = await getDatabase()
    .from('session_records')
    .insert({
      user_id: userId,
      agent_id: input.agentId,
      agent_name: input.agentName,
      instance_id: input.instanceId,
      instance_index: input.instanceIndex,
      instance_tag: input.instanceTag,
      prompt: input.prompt,
      log_dir: input.logDir,
      claude_session_id: input.claudeSessionId,
      marketplace_agent_id: input.marketplaceAgentId ?? null
    })
    .select()
    .single()

  if (error) throw error
  return data
}

export async function updateSession(id: string, input: UpdateSessionInput) {
  const userId = getUserId()
  const updateData: Record<string, unknown> = {}

  if (input.endedAt !== undefined) updateData.ended_at = input.endedAt
  if (input.durationMs !== undefined) updateData.duration_ms = input.durationMs
  if (input.claudeSessionId !== undefined) updateData.claude_session_id = input.claudeSessionId

  const { data, error } = await getDatabase()
    .from('session_records')
    .update(updateData)
    .eq('id', id)
    .eq('user_id', userId)
    .select()
    .single()

  if (error) throw error
  return data
}

export async function deleteSession(id: string) {
  const userId = getUserId()
  const { error } = await getDatabase()
    .from('session_records')
    .delete()
    .eq('id', id)
    .eq('user_id', userId)

  if (error) throw error
}

// ============================================================================
// Cron Operations
// ============================================================================

export async function getCrons(agentId: string) {
  const userId = getUserId()
  const { data, error } = await getDatabase()
    .from('cron_definitions')
    .select('*')
    .eq('user_id', userId)
    .eq('agent_id', agentId)
    .order('created_at', { ascending: false })

  if (error) throw error
  return data
}

export async function getCron(id: string) {
  const userId = getUserId()
  const { data, error } = await getDatabase()
    .from('cron_definitions')
    .select('*')
    .eq('id', id)
    .eq('user_id', userId)
    .single()

  if (error) throw error
  return data
}

export async function createCron(input: CreateCronInput) {
  const userId = getUserId()
  const { data, error } = await getDatabase()
    .from('cron_definitions')
    .insert({
      user_id: userId,
      agent_id: input.agentId,
      label: input.label,
      schedule: input.schedule,
      args: input.args || {},
      enabled: input.enabled ?? true
    })
    .select()
    .single()

  if (error) throw error
  return data
}

export async function updateCron(id: string, input: UpdateCronInput) {
  const userId = getUserId()
  const updateData: Record<string, unknown> = {}

  if (input.label !== undefined) updateData.label = input.label
  if (input.schedule !== undefined) updateData.schedule = input.schedule
  if (input.args !== undefined) updateData.args = input.args
  if (input.enabled !== undefined) updateData.enabled = input.enabled

  const { data, error } = await getDatabase()
    .from('cron_definitions')
    .update(updateData)
    .eq('id', id)
    .eq('user_id', userId)
    .select()
    .single()

  if (error) throw error
  return data
}

export async function deleteCron(id: string) {
  const userId = getUserId()
  const { error } = await getDatabase()
    .from('cron_definitions')
    .delete()
    .eq('id', id)
    .eq('user_id', userId)

  if (error) throw error
}
