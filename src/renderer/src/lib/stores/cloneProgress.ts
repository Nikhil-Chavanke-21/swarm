import { writable } from 'svelte/store'

export type RepoCloneStatus = 'pending' | 'cloning' | 'done' | 'error'

// instanceId -> { repoName -> status }
export const cloneProgress = writable<Record<string, Record<string, RepoCloneStatus>>>({})

export function updateCloneProgress(instanceId: string, repo: string, status: RepoCloneStatus): void {
  cloneProgress.update((all) => ({
    ...all,
    [instanceId]: { ...(all[instanceId] ?? {}), [repo]: status }
  }))
}

export function clearCloneProgress(instanceId: string): void {
  cloneProgress.update((all) => {
    const next = { ...all }
    delete next[instanceId]
    return next
  })
}
