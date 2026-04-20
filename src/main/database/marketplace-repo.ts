import { getDatabase } from './supabase'
import { getUserId } from './user-store'
import type { AgentArg, RepoEntry } from './repositories'

// ─── Types ────────────────────────────────────────────────────────────────

export interface MarketplaceAgentRow {
  id: string
  name: string
  emoji: string | null
  description: string | null
  use_when: string | null
  claude_md_content: string | null
  args: AgentArg[]
  mcp_requirements: string[]
  allowed_commands: string[]
  repos: RepoEntry[]
  created_by: string | null
  updated_by: string | null
  created_at: string
  updated_at: string
}

export interface MarketplaceAgentWithStats extends MarketplaceAgentRow {
  star_count: number
  starred_by_me: boolean
  mine: boolean
  my_personal_agent_id: string | null
}

export interface CreateMarketplaceAgentInput {
  name: string
  emoji?: string
  description?: string
  useWhen?: string
  claudeMdContent?: string
  args?: AgentArg[]
  mcpRequirements?: string[]
  allowedCommands?: string[]
  repos?: RepoEntry[]
}

export interface UpdateMarketplaceAgentInput {
  name?: string
  emoji?: string
  description?: string
  useWhen?: string
  claudeMdContent?: string
  args?: AgentArg[]
  mcpRequirements?: string[]
  allowedCommands?: string[]
  repos?: RepoEntry[]
}

// ─── Agent CRUD ───────────────────────────────────────────────────────────

export async function listMarketplaceAgents(): Promise<MarketplaceAgentRow[]> {
  const { data, error } = await getDatabase()
    .from('marketplace_agents')
    .select('*')
    .order('created_at', { ascending: false })

  if (error) throw error
  return (data || []) as MarketplaceAgentRow[]
}

export async function getMarketplaceAgent(id: string): Promise<MarketplaceAgentRow | null> {
  const { data, error } = await getDatabase()
    .from('marketplace_agents')
    .select('*')
    .eq('id', id)
    .maybeSingle()

  if (error) throw error
  return data as MarketplaceAgentRow | null
}

export async function createMarketplaceAgent(
  input: CreateMarketplaceAgentInput
): Promise<MarketplaceAgentRow> {
  const userId = getUserId()
  const { data, error } = await getDatabase()
    .from('marketplace_agents')
    .insert({
      name: input.name,
      emoji: input.emoji,
      description: input.description,
      use_when: input.useWhen,
      claude_md_content: input.claudeMdContent,
      args: input.args || [],
      mcp_requirements: input.mcpRequirements || [],
      allowed_commands: input.allowedCommands || [],
      repos: input.repos || [],
      created_by: userId,
      updated_by: userId
    })
    .select()
    .single()

  if (error) throw error
  return data as MarketplaceAgentRow
}

/**
 * Update a marketplace agent. Returns null if the current user is not the
 * owner (the `.eq('created_by', userId)` filter matches zero rows).
 */
export async function updateMarketplaceAgentIfOwner(
  id: string,
  input: UpdateMarketplaceAgentInput
): Promise<MarketplaceAgentRow | null> {
  const userId = getUserId()
  const payload: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
    updated_by: userId
  }
  if (input.name !== undefined) payload.name = input.name
  if (input.emoji !== undefined) payload.emoji = input.emoji
  if (input.description !== undefined) payload.description = input.description
  if (input.useWhen !== undefined) payload.use_when = input.useWhen
  if (input.claudeMdContent !== undefined) payload.claude_md_content = input.claudeMdContent
  if (input.args !== undefined) payload.args = input.args
  if (input.mcpRequirements !== undefined) payload.mcp_requirements = input.mcpRequirements
  if (input.allowedCommands !== undefined) payload.allowed_commands = input.allowedCommands
  if (input.repos !== undefined) payload.repos = input.repos

  const { data, error } = await getDatabase()
    .from('marketplace_agents')
    .update(payload)
    .eq('id', id)
    .eq('created_by', userId)
    .select()
    .maybeSingle()

  if (error) throw error
  return (data ?? null) as MarketplaceAgentRow | null
}

/** Ownership-guarded delete. Returns true if a row was deleted. */
export async function deleteMarketplaceAgentIfOwner(id: string): Promise<boolean> {
  const userId = getUserId()
  const { data, error } = await getDatabase()
    .from('marketplace_agents')
    .delete()
    .eq('id', id)
    .eq('created_by', userId)
    .select('id')

  if (error) throw error
  return Array.isArray(data) && data.length > 0
}

// ─── Stars ────────────────────────────────────────────────────────────────

export async function starMarketplaceAgent(marketplaceAgentId: string): Promise<void> {
  const userId = getUserId()
  const { error } = await getDatabase()
    .from('marketplace_stars')
    .upsert(
      { user_id: userId, marketplace_agent_id: marketplaceAgentId },
      { onConflict: 'user_id,marketplace_agent_id' }
    )
  if (error) throw error
}

export async function unstarMarketplaceAgent(marketplaceAgentId: string): Promise<void> {
  const userId = getUserId()
  const { error } = await getDatabase()
    .from('marketplace_stars')
    .delete()
    .eq('user_id', userId)
    .eq('marketplace_agent_id', marketplaceAgentId)
  if (error) throw error
}

async function getStarCounts(): Promise<Map<string, number>> {
  const { data, error } = await getDatabase()
    .from('marketplace_stars')
    .select('marketplace_agent_id')
  if (error) throw error
  const counts = new Map<string, number>()
  for (const row of data || []) {
    const id = (row as { marketplace_agent_id: string }).marketplace_agent_id
    counts.set(id, (counts.get(id) || 0) + 1)
  }
  return counts
}

async function getMyStarredIds(): Promise<Set<string>> {
  const userId = getUserId()
  const { data, error } = await getDatabase()
    .from('marketplace_stars')
    .select('marketplace_agent_id')
    .eq('user_id', userId)
  if (error) throw error
  return new Set((data || []).map((r: any) => r.marketplace_agent_id as string))
}

// ─── Ownership lookup ────────────────────────────────────────────────────

/**
 * Return a map of `marketplace_agent_id → my personal agent id` for every
 * personal agent the current user owns that publishes a marketplace entry.
 */
async function getMyLinkedPersonalAgents(): Promise<Map<string, string>> {
  const userId = getUserId()
  const { data, error } = await getDatabase()
    .from('agents')
    .select('id, marketplace_agent_id')
    .eq('user_id', userId)
    .not('marketplace_agent_id', 'is', null)

  if (error) throw error
  const map = new Map<string, string>()
  for (const row of data || []) {
    const r = row as { id: string; marketplace_agent_id: string | null }
    if (r.marketplace_agent_id) map.set(r.marketplace_agent_id, r.id)
  }
  return map
}

/** Clear `marketplace_agent_id` on the user's linked personal agent, if any. */
export async function clearMyMarketplaceLink(marketplaceAgentId: string): Promise<void> {
  const userId = getUserId()
  const { error } = await getDatabase()
    .from('agents')
    .update({ marketplace_agent_id: null })
    .eq('user_id', userId)
    .eq('marketplace_agent_id', marketplaceAgentId)
  if (error) throw error
}

// ─── Composite listing ────────────────────────────────────────────────────

export async function listMarketplaceAgentsWithStats(): Promise<MarketplaceAgentWithStats[]> {
  const userId = getUserId()
  const [agents, starCounts, myStarred, myLinked] = await Promise.all([
    listMarketplaceAgents(),
    getStarCounts(),
    getMyStarredIds(),
    getMyLinkedPersonalAgents()
  ])

  return agents.map((a) => ({
    ...a,
    star_count: starCounts.get(a.id) || 0,
    starred_by_me: myStarred.has(a.id),
    mine: a.created_by === userId,
    my_personal_agent_id: myLinked.get(a.id) ?? null
  }))
}
