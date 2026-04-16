import { writable } from 'svelte/store'
import { activeSessionId, activeLogTabId } from './ui'
import type { AgentSession, InstanceStatus } from '../types'

export const sessions = writable<AgentSession[]>([])

export async function spawnSession(
  agentId: string,
  instanceId: string,
  args: Record<string, string>
): Promise<AgentSession> {
  const session = await window.api.agentSpawn(agentId, instanceId, args)
  sessions.update((list) => [...list, session])
  activeSessionId.set(session.id)
  activeLogTabId.set(null)
  return session
}

export async function resumeSession(
  agentId: string,
  instanceId: string,
  claudeSessionId: string
): Promise<AgentSession> {
  const session = await window.api.agentResume(agentId, instanceId, claudeSessionId)
  sessions.update((list) => [...list, session])
  activeSessionId.set(session.id)
  activeLogTabId.set(null)
  return session
}

export function updateSessionStatus(sessionId: string, status: InstanceStatus): void {
  sessions.update((list) =>
    list.map((s) => (s.id === sessionId ? { ...s, status } : s))
  )
}

export function removeSession(sessionId: string): void {
  sessions.update((list) => list.filter((s) => s.id !== sessionId))
}
