import { writable } from 'svelte/store'
import type { AgentDefinition, AgentArg } from '../types'

export const agents = writable<AgentDefinition[]>([])

export async function loadAgents(): Promise<void> {
  try {
    const list = await window.api.agentList()
    agents.set(list)
  } catch (err) {
    console.error('Failed to load agents:', err)
  }
}

export interface CreateAgentInput {
  name: string
  description: string
  useWhen: string
  claudeMdBody: string
  args: AgentArg[]
  mcpRequirements: string[]
  allowedCommands: string[]
  repos: string[]
}

export async function createAgent(input: CreateAgentInput): Promise<void> {
  await window.api.agentCreate(input)
  await loadAgents()
}

export async function updateAgent(agentId: string, input: CreateAgentInput): Promise<void> {
  await window.api.agentUpdate(agentId, input)
  await loadAgents()
}

export async function deleteAgent(agentId: string): Promise<void> {
  await window.api.agentDelete(agentId)
  await loadAgents()
}
