import { writable } from 'svelte/store'
import type { AgentArg, RepoEntry } from '../types'

export interface MarketplaceAgent {
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
  star_count: number
  starred_by_me: boolean
  mine: boolean
  my_personal_agent_id: string | null
}

export const marketplaceAgents = writable<MarketplaceAgent[]>([])
export const marketplaceLoading = writable(false)

/**
 * Strip Svelte 5 reactive proxies from a value so it can cross the Electron
 * IPC boundary (structured clone cannot serialize proxies).
 */
function toPlain<T>(value: T): T {
  return JSON.parse(JSON.stringify(value))
}

export async function loadMarketplace(): Promise<void> {
  marketplaceLoading.set(true)
  try {
    const list = await window.api.marketplaceList()
    marketplaceAgents.set(list as MarketplaceAgent[])
  } catch (err) {
    console.error('[marketplace] loadMarketplace failed:', err)
    marketplaceAgents.set([])
  } finally {
    marketplaceLoading.set(false)
  }
}

export async function toggleStar(agentId: string, currentlyStarred: boolean): Promise<void> {
  const next = !currentlyStarred

  marketplaceAgents.update((list) =>
    list.map((a) =>
      a.id === agentId
        ? {
            ...a,
            starred_by_me: next,
            star_count: Math.max(0, a.star_count + (next ? 1 : -1))
          }
        : a
    )
  )

  try {
    await window.api.marketplaceToggleStar(agentId, next)
  } catch (err) {
    console.error('[marketplace] toggleStar failed:', err)
    marketplaceAgents.update((list) =>
      list.map((a) =>
        a.id === agentId
          ? {
              ...a,
              starred_by_me: currentlyStarred,
              star_count: Math.max(0, a.star_count + (next ? -1 : 1))
            }
          : a
      )
    )
  }
}

export async function cloneMarketplaceAgent(agentId: string): Promise<string> {
  const localAgentId = (await window.api.marketplaceClone(agentId)) as string
  await loadMarketplace()
  return localAgentId
}

export async function publishLocalAgent(localAgentId: string): Promise<string> {
  const id = (await window.api.marketplacePublish(localAgentId)) as string
  await loadMarketplace()
  return id
}

export async function republishMyMarketplaceAgent(localAgentId: string): Promise<void> {
  await window.api.marketplaceRepublish(localAgentId)
  await loadMarketplace()
}

export async function deleteMyMarketplaceAgent(marketplaceAgentId: string): Promise<void> {
  await window.api.marketplaceDelete(marketplaceAgentId)
  await loadMarketplace()
}

export interface WikiEditInput {
  name: string
  emoji: string
  description: string
  useWhen: string
  claudeMdBody: string
  args: AgentArg[]
  mcpRequirements: string[]
  allowedCommands: string[]
  repos: RepoEntry[]
}

export async function updateMyMarketplaceAgent(agentId: string, input: WikiEditInput): Promise<void> {
  await window.api.marketplaceUpdate(agentId, toPlain(input))
  await loadMarketplace()
}
