import { writable } from 'svelte/store'
import type { SessionRecord } from '../types'

export const logTabs = writable<SessionRecord[]>([])

export function openLogTab(record: SessionRecord): void {
  logTabs.update((tabs) => {
    if (tabs.find((t) => t.id === record.id)) return tabs
    return [...tabs, record]
  })
}

export function closeLogTab(id: string): void {
  logTabs.update((tabs) => tabs.filter((t) => t.id !== id))
}

export function updateLogTabClaudeId(sessionId: string, claudeSessionId: string): void {
  logTabs.update((tabs) =>
    tabs.map((t) => (t.id === sessionId ? { ...t, claudeSessionId } : t))
  )
}
