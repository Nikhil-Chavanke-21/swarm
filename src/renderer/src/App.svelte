<script lang="ts">
  import { onMount, onDestroy } from 'svelte'
  import Sidebar from './lib/components/Sidebar.svelte'
  import TabBar from './lib/components/TabBar.svelte'
  import Terminal from './lib/components/Terminal.svelte'
  import SessionViewer from './lib/components/SessionViewer.svelte'
  import NewAgentModal from './lib/components/NewAgentModal.svelte'
  import CreateAgentModal from './lib/components/CreateAgentModal.svelte'
  import FileBrowser from './lib/components/FileBrowser.svelte'
  import { sessions, updateSessionStatus, removeSession } from './lib/stores/sessions'
  import { activeSessionId, activeLogTabId, showFileBrowser } from './lib/stores/ui'
  import { logTabs, closeLogTab, updateLogTabClaudeId } from './lib/stores/logTabs'
  import { loadAgents } from './lib/stores/agents'
  import { updateCloneProgress, clearCloneProgress } from './lib/stores/cloneProgress'
  import type { InstanceStatus } from './lib/types'
  import { get } from 'svelte/store'

  let cleanupStatus: (() => void) | null = null
  let cleanupExit: (() => void) | null = null
  let cleanupShortcut: (() => void) | null = null
  let cleanupInstanceReady: (() => void) | null = null
  let cleanupClaudeId: (() => void) | null = null

  function closeCurrentTab() {
    const logId = get(activeLogTabId)
    if (logId) {
      closeLogTab(logId)
      activeLogTabId.set(null)
      return
    }
    const id = get(activeSessionId)
    if (!id) return
    window.api.ptyKill(id)
    removeSession(id)
    const remaining = get(sessions)
    activeSessionId.set(remaining.length > 0 ? remaining[remaining.length - 1].id : null)
  }

  function switchTab(direction: 1 | -1) {
    // Build unified tab list: live sessions first, then log tabs
    const liveSessions = get(sessions)
    const logTabList = get(logTabs)
    const allTabs = [
      ...liveSessions.map((s) => ({ id: s.id, type: 'live' as const })),
      ...logTabList.map((t) => ({ id: t.id, type: 'log' as const }))
    ]
    if (allTabs.length < 2) return

    const logId = get(activeLogTabId)
    const liveId = get(activeSessionId)
    const currentId = logId ?? liveId
    const idx = allTabs.findIndex((t) => t.id === currentId)
    const next = allTabs[(idx + direction + allTabs.length) % allTabs.length]

    if (next.type === 'live') {
      activeSessionId.set(next.id)
      activeLogTabId.set(null)
    } else {
      activeLogTabId.set(next.id)
      activeSessionId.set(null)
    }
  }

  onMount(() => {
    cleanupStatus = window.api.onPtyStatus(({ instanceId, status }) => {
      updateSessionStatus(instanceId, status as InstanceStatus)
    })

    cleanupExit = window.api.onPtyExit(({ instanceId }) => {
      removeSession(instanceId)
      // If this was the active session, clear it
      if (get(activeSessionId) === instanceId) {
        const remaining = get(sessions)
        activeSessionId.set(remaining.length > 0 ? remaining[remaining.length - 1].id : null)
      }
    })

    cleanupClaudeId = window.api.onSessionClaudeId(({ sessionId, claudeSessionId }) => {
      updateLogTabClaudeId(sessionId, claudeSessionId)
    })

    cleanupInstanceReady = window.api.onInstanceReady(({ instanceId }) => {
      clearCloneProgress(instanceId)
      loadAgents()
    })

    window.api.onCloneProgress(({ instanceId, repo, status }) => {
      updateCloneProgress(instanceId, repo, status as any)
    })

    cleanupShortcut = window.api.onShortcut((action) => {
      switch (action) {
        case 'close-tab': closeCurrentTab(); break
        case 'next-tab': switchTab(1); break
        case 'prev-tab': switchTab(-1); break
      }
    })
  })

  onDestroy(() => {
    cleanupStatus?.()
    cleanupExit?.()
    cleanupShortcut?.()
    cleanupInstanceReady?.()
    cleanupClaudeId?.()
  })

  const activeLogRecord = $derived($logTabs.find((t) => t.id === $activeLogTabId) ?? null)
</script>

<div class="app">
  <div class="titlebar">
    <span class="titlebar-label">Swarm</span>
  </div>

  <div class="body">
    <Sidebar />

    <div class="main-area">
      <TabBar />

      <div class="content">
        <div class="terminal-area">
          {#if activeLogRecord}
            {#key activeLogRecord.id}
              <SessionViewer record={activeLogRecord} />
            {/key}
          {:else if $activeSessionId}
            {#each $sessions as session (session.id)}
              <div class="terminal-wrapper" class:hidden={session.id !== $activeSessionId}>
                <Terminal instanceId={session.id} />
              </div>
            {/each}
          {:else}
            <div class="empty-state">
              <h2>Swarm</h2>
              <p>Select an agent from the sidebar and launch a new instance to get started.</p>
            </div>
          {/if}
        </div>

        <FileBrowser />
      </div>

      {#if $activeSessionId && !$activeLogTabId}
        <div class="toolbar">
          <button
            class="toolbar-btn"
            class:active={$showFileBrowser}
            onclick={() => showFileBrowser.update((v) => !v)}
          >
            Files
          </button>
        </div>
      {/if}
    </div>
  </div>

  <NewAgentModal />
  <CreateAgentModal />
</div>

<style>
  .app {
    display: flex;
    flex-direction: column;
    height: 100vh;
    background: #1e1e2e;
    color: #cdd6f4;
    overflow: hidden;
  }

  .titlebar {
    height: 38px;
    min-height: 38px;
    background: #11111b;
    border-bottom: 1px solid #313244;
    display: flex;
    align-items: center;
    justify-content: center;
    -webkit-app-region: drag;
    user-select: none;
  }

  .titlebar-label {
    font-size: 12px;
    font-weight: 600;
    color: #585b70;
    letter-spacing: 0.5px;
  }

  .body {
    flex: 1;
    display: flex;
    overflow: hidden;
  }

  .main-area {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    position: relative;
  }

  .content {
    flex: 1;
    display: flex;
    overflow: hidden;
  }

  .terminal-area {
    flex: 1;
    position: relative;
    overflow: hidden;
  }

  .terminal-wrapper {
    position: absolute;
    inset: 0;
  }

  .terminal-wrapper.hidden {
    visibility: hidden;
  }

  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100%;
    color: #45475a;
  }

  .empty-state h2 {
    font-size: 32px;
    font-weight: 700;
    margin: 0 0 8px;
  }

  .empty-state p {
    font-size: 14px;
    color: #585b70;
    max-width: 360px;
    text-align: center;
    line-height: 1.5;
  }

  .toolbar {
    position: absolute;
    bottom: 0;
    right: 0;
    padding: 8px;
    display: flex;
    gap: 4px;
  }

  .toolbar-btn {
    padding: 4px 12px;
    border-radius: 6px;
    border: 1px solid #313244;
    background: #1e1e2e;
    color: #6c7086;
    font-size: 11px;
    cursor: pointer;
  }

  .toolbar-btn:hover, .toolbar-btn.active {
    background: #313244;
    color: #cdd6f4;
  }
</style>
