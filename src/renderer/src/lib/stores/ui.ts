import { writable } from 'svelte/store'

export const activeSessionId = writable<string | null>(null)
export const showNewAgentModal = writable(false)
export const selectedAgentId = writable<string | null>(null)
export const showCreateAgentModal = writable(false)
export const editingAgentId = writable<string | null>(null)
export const showFileBrowser = writable(false)
export const sidebarCollapsed = writable(false)
export const selectedInstanceId = writable<string | null>(null)
export const activeLogTabId = writable<string | null>(null)
