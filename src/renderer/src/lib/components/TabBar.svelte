<script lang="ts">
  import { sessions, removeSession } from '../stores/sessions'
  import { activeSessionId, activeLogTabId } from '../stores/ui'
  import { logTabs, closeLogTab } from '../stores/logTabs'

  import { get } from 'svelte/store'

  function selectLiveTab(id: string) {
    activeSessionId.set(id)
    activeLogTabId.set(null)
  }

  function selectLogTab(id: string) {
    activeLogTabId.set(id)
    activeSessionId.set(null)
  }

  function closeLiveTab(id: string, e: MouseEvent) {
    e.stopPropagation()
    window.api.ptyKill(id)
    removeSession(id)
    if (get(activeSessionId) === id) {
      const remaining = get(sessions).filter((s) => s.id !== id)
      activeSessionId.set(remaining.length > 0 ? remaining[remaining.length - 1].id : null)
    }
  }

  function closeLog(id: string, e: MouseEvent) {
    e.stopPropagation()
    closeLogTab(id)
    if (get(activeLogTabId) === id) {
      const remaining = get(logTabs).filter((t) => t.id !== id)
      if (remaining.length > 0) {
        activeLogTabId.set(remaining[remaining.length - 1].id)
      } else {
        activeLogTabId.set(null)
        // Fall back to last live session if any
        const liveSessions = get(sessions)
        if (liveSessions.length > 0) {
          activeSessionId.set(liveSessions[liveSessions.length - 1].id)
        }
      }
    }
  }

  function formatLogDate(iso: string): string {
    const d = new Date(iso)
    return `${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} ${d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`
  }
</script>

<div class="tab-bar">
  {#each $sessions as session (session.id)}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="tab live"
      class:active={$activeSessionId === session.id && !$activeLogTabId}
      onclick={() => selectLiveTab(session.id)}
      onkeydown={(e) => e.key === 'Enter' && selectLiveTab(session.id)}
      role="tab"
      tabindex="0"
    >
      <span class="tab-name">{session.agentName} #{session.instanceIndex}{session.instanceTag ? ` · ${session.instanceTag}` : ''}</span>
      <button class="close-btn" onclick={(e) => closeLiveTab(session.id, e)} title="Close">x</button>
    </div>
  {/each}

  {#each $logTabs as record (record.id)}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="tab log"
      class:active={$activeLogTabId === record.id}
      onclick={() => selectLogTab(record.id)}
      onkeydown={(e) => e.key === 'Enter' && selectLogTab(record.id)}
      role="tab"
      tabindex="0"
    >
      <span class="tab-name">{record.agentName} · {formatLogDate(record.startedAt)}</span>
      <button class="close-btn" onclick={(e) => closeLog(record.id, e)} title="Close">x</button>
    </div>
  {/each}
</div>

<style>
  .tab-bar {
    display: flex;
    background: #11111b;
    border-bottom: 1px solid #313244;
    overflow-x: auto;
    min-height: 40px;
  }

  .tab {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 16px;
    background: transparent;
    border: none;
    border-right: 1px solid #313244;
    color: #6c7086;
    cursor: pointer;
    font-size: 12px;
    white-space: nowrap;
    -webkit-app-region: no-drag;
    transition: background 0.15s;
  }

  .tab:hover {
    background: #1e1e2e;
  }

  .tab.active {
    background: #1e1e2e;
    color: #cdd6f4;
  }

  .tab.live.active {
    border-bottom: 2px solid #89b4fa;
  }

  .tab.log.active {
    border-bottom: 2px solid #f9e2af;
  }

  .tab-name {
    font-weight: 500;
  }

  .close-btn {
    background: none;
    border: none;
    color: #585b70;
    cursor: pointer;
    font-size: 12px;
    padding: 0 2px;
    line-height: 1;
    border-radius: 4px;
  }

  .close-btn:hover {
    background: #45475a;
    color: #f38ba8;
  }
</style>
