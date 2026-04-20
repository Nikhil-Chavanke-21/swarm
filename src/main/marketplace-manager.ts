import { mkdir, writeFile } from 'fs/promises'
import { join } from 'path'
import { homedir } from 'os'
import { stringify as stringifyYaml } from 'yaml'
import {
  listMarketplaceAgentsWithStats,
  getMarketplaceAgent as repoGetMarketplaceAgent,
  createMarketplaceAgent as repoCreateMarketplaceAgent,
  updateMarketplaceAgentIfOwner,
  deleteMarketplaceAgentIfOwner,
  clearMyMarketplaceLink,
  starMarketplaceAgent as repoStar,
  unstarMarketplaceAgent as repoUnstar,
  type MarketplaceAgentWithStats,
  type MarketplaceAgentRow
} from './database/marketplace-repo'
import {
  createAgent as repoCreateAgent,
  updateAgent as repoUpdateAgent,
  getAgent as repoGetAgent,
  type AgentArg,
  type RepoEntry
} from './database/repositories'
import { getUserId } from './database/user-store'
import { createInstance, syncAgentDiskFiles } from './agent-manager'

const SWARM_DIR = join(homedir(), '.swarm')
const AGENTS_DIR = join(SWARM_DIR, 'agents')

// ─── helpers ──────────────────────────────────────────────────────────────

function buildClaudeMd(params: {
  name: string
  emoji: string
  description: string
  useWhen: string
  args: AgentArg[]
  mcpRequirements: string[]
  repos: RepoEntry[]
  body: string
}): string {
  const frontmatter: Record<string, unknown> = {
    name: params.name,
    description: params.description
  }
  if (params.emoji) frontmatter.emoji = params.emoji
  if (params.useWhen) frontmatter.useWhen = params.useWhen
  if (params.args.length > 0) frontmatter.args = params.args
  if (params.mcpRequirements.length > 0) frontmatter.mcp = params.mcpRequirements
  if (params.repos.length > 0) frontmatter.repos = params.repos

  let reposSection = ''
  if (params.repos.length > 0) {
    reposSection = `\n## Repos\n\n`
    for (const repo of params.repos) {
      reposSection += `- **${repo.name}:** \`./${repo.name}\`\n`
    }
    reposSection += `\nThese repos are cloned in your working directory. Reference them using the relative paths above.\n\n`
  }

  return `---\n${stringifyYaml(frontmatter).trim()}\n---\n${reposSection}# Agent Instructions\n\n${params.body}`
}

async function writeAgentFiles(
  agentId: string,
  claudeMdContent: string,
  allowedCommands: string[]
): Promise<void> {
  const agentDir = join(AGENTS_DIR, agentId)
  await mkdir(agentDir, { recursive: true })
  await writeFile(join(agentDir, 'CLAUDE.md'), claudeMdContent, 'utf-8')
  if (allowedCommands.length > 0) {
    const settingsDir = join(agentDir, '.claude')
    await mkdir(settingsDir, { recursive: true })
    await writeFile(
      join(settingsDir, 'settings.local.json'),
      JSON.stringify({ permissions: { allow: allowedCommands } }, null, 2),
      'utf-8'
    )
  }
}

// ─── public API ───────────────────────────────────────────────────────────

export async function listAgents(): Promise<MarketplaceAgentWithStats[]> {
  return listMarketplaceAgentsWithStats()
}

export async function toggleStar(
  marketplaceAgentId: string,
  starred: boolean
): Promise<void> {
  if (starred) await repoStar(marketplaceAgentId)
  else await repoUnstar(marketplaceAgentId)
}

/**
 * Clone a marketplace agent into the current user's personal agents as a
 * fully detached copy. The resulting personal agent has
 * `marketplace_agent_id = null` — it is not linked back.
 * Returns the new personal agent id.
 */
export async function cloneAgent(marketplaceAgentId: string): Promise<string> {
  const mp = await repoGetMarketplaceAgent(marketplaceAgentId)
  if (!mp) throw new Error(`Marketplace agent not found: ${marketplaceAgentId}`)

  const claudeMdContent = mp.claude_md_content ?? buildClaudeMd({
    name: mp.name,
    emoji: mp.emoji ?? '',
    description: mp.description ?? '',
    useWhen: mp.use_when ?? '',
    args: mp.args || [],
    mcpRequirements: mp.mcp_requirements || [],
    repos: mp.repos || [],
    body: ''
  })

  const row = await repoCreateAgent({
    name: mp.name,
    emoji: mp.emoji ?? '🤖',
    description: mp.description ?? '',
    useWhen: mp.use_when ?? '',
    claudeMdContent,
    args: mp.args || [],
    mcpRequirements: mp.mcp_requirements || [],
    allowedCommands: mp.allowed_commands || [],
    repos: mp.repos || [],
    marketplaceAgentId: undefined
  })

  const localAgentId = row.id as string
  await writeAgentFiles(localAgentId, claudeMdContent, mp.allowed_commands || [])

  try {
    await createInstance(localAgentId)
  } catch (err) {
    console.warn('[marketplace] createInstance failed after clone:', err)
  }

  return localAgentId
}

/**
 * Publish an existing personal agent as a new marketplace entry.
 * Creates the marketplace row (owned by the current user) and links the
 * personal agent via `marketplace_agent_id`, enabling future Republish.
 */
export async function publishAgent(localAgentId: string): Promise<string> {
  const local = await repoGetAgent(localAgentId)
  if (!local) throw new Error(`Local agent not found: ${localAgentId}`)

  if ((local as any).marketplace_agent_id) {
    throw new Error('This agent is already linked to a marketplace entry. Use Republish to update it.')
  }

  const created = await repoCreateMarketplaceAgent({
    name: local.name as string,
    emoji: (local.emoji as string) || undefined,
    description: (local.description as string) || undefined,
    useWhen: (local.use_when as string) || undefined,
    claudeMdContent: (local.claude_md_content as string) || undefined,
    args: (local.args as AgentArg[]) || [],
    mcpRequirements: (local.mcp_requirements as string[]) || [],
    allowedCommands: (local.allowed_commands as string[]) || [],
    repos: (local.repos as RepoEntry[]) || []
  })

  await repoUpdateAgent(localAgentId, { marketplaceAgentId: created.id })

  return created.id
}

/**
 * Republish: overwrite the marketplace entry owned by the current user with
 * the latest content from their linked personal agent. Requires:
 *   1) the personal agent has `marketplace_agent_id` set
 *   2) the current user owns that marketplace entry
 */
export async function republishAgent(localAgentId: string): Promise<MarketplaceAgentRow> {
  const local = await repoGetAgent(localAgentId)
  if (!local) throw new Error(`Local agent not found: ${localAgentId}`)

  const marketplaceAgentId = (local as any).marketplace_agent_id as string | null
  if (!marketplaceAgentId) {
    throw new Error('This agent is not linked to a marketplace entry. Publish it first.')
  }

  const updated = await updateMarketplaceAgentIfOwner(marketplaceAgentId, {
    name: local.name as string,
    emoji: (local.emoji as string) || undefined,
    description: (local.description as string) || undefined,
    useWhen: (local.use_when as string) || undefined,
    claudeMdContent: (local.claude_md_content as string) || undefined,
    args: (local.args as AgentArg[]) || [],
    mcpRequirements: (local.mcp_requirements as string[]) || [],
    allowedCommands: (local.allowed_commands as string[]) || [],
    repos: (local.repos as RepoEntry[]) || []
  })

  if (!updated) {
    throw new Error('You do not own this marketplace entry.')
  }

  return updated
}

/**
 * Update my marketplace entry directly (from the wiki-style edit modal).
 * Server-side ownership guard via `updateMarketplaceAgentIfOwner`.
 * Also mirrors the change into my linked personal agent so the next launch
 * uses the new definition.
 */
export async function updateMyAgentFromBody(
  marketplaceAgentId: string,
  input: {
    name: string
    emoji: string
    description: string
    useWhen: string
    claudeMdBody: string
    args: AgentArg[]
    mcpRequirements: string[]
    repos: RepoEntry[]
    allowedCommands: string[]
  }
): Promise<MarketplaceAgentRow> {
  const claudeMdContent = buildClaudeMd({
    name: input.name,
    emoji: input.emoji,
    description: input.description,
    useWhen: input.useWhen,
    args: input.args,
    mcpRequirements: input.mcpRequirements,
    repos: input.repos,
    body: input.claudeMdBody
  })

  const updated = await updateMarketplaceAgentIfOwner(marketplaceAgentId, {
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

  if (!updated) {
    throw new Error('You do not own this marketplace entry.')
  }

  // Mirror into my linked personal agent (if any) + disk
  const userId = getUserId()
  const { getDatabase } = await import('./database/supabase')
  const { data } = await getDatabase()
    .from('agents')
    .select('id')
    .eq('user_id', userId)
    .eq('marketplace_agent_id', marketplaceAgentId)
    .maybeSingle()

  const myLocalId = (data as { id: string } | null)?.id
  if (myLocalId) {
    await repoUpdateAgent(myLocalId, {
      name: updated.name,
      emoji: updated.emoji ?? undefined,
      description: updated.description ?? undefined,
      useWhen: updated.use_when ?? undefined,
      claudeMdContent: updated.claude_md_content ?? undefined,
      args: updated.args || [],
      mcpRequirements: updated.mcp_requirements || [],
      allowedCommands: updated.allowed_commands || [],
      repos: updated.repos || []
    })
    if (updated.claude_md_content) {
      // Propagate to agent dir AND all instance working dirs.
      await syncAgentDiskFiles(
        myLocalId,
        updated.claude_md_content,
        updated.allowed_commands || []
      )
    }
  }

  return updated
}

/**
 * Delete a marketplace entry I own. Other users' clones are detached copies
 * and remain intact on their side. Clears the link on my personal agent so
 * the Publish button reappears.
 */
export async function deleteMyAgent(marketplaceAgentId: string): Promise<void> {
  const deleted = await deleteMarketplaceAgentIfOwner(marketplaceAgentId)
  if (!deleted) throw new Error('You do not own this marketplace entry.')
  await clearMyMarketplaceLink(marketplaceAgentId)
}
