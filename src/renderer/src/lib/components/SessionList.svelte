<script lang="ts">
  import { onMount } from 'svelte'
  import { agents } from '../stores/agents'
  import { sessions } from '../stores/sessions'
  import { activeSessionId, activeLogTabId } from '../stores/ui'
  import { logTabs, openLogTab } from '../stores/logTabs'
  import { get } from 'svelte/store'
  import type { SessionRecord } from '../types'

  function handleSelect(record: SessionRecord) {
    // If this session is currently running, switch to its live tab
    const liveSession = get(sessions).find((s) => s.id === record.id)
    if (liveSession) {
      activeSessionId.set(record.id)
      activeLogTabId.set(null)
      return
    }
    // Otherwise open as a log viewer tab
    openLogTab(record)
    activeLogTabId.set(record.id)
    activeSessionId.set(null)
  }

  let records = $state<SessionRecord[]>([])
  let filterAgentId = $state('')
  let textQuery = $state('')
  let loading = $state(false)
  let searching = $state(false)

  onMount(async () => {
    await loadAll()
  })

  async function loadAll() {
    loading = true
    records = await window.api.sessionsList()
    loading = false
  }

  async function handleSearch() {
    if (!textQuery.trim() && !filterAgentId) {
      await loadAll()
      return
    }
    searching = true
    records = await window.api.sessionsSearch(textQuery, filterAgentId || undefined)
    searching = false
  }

  function handleTextKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') handleSearch()
  }

  function formatDate(iso: string): string {
    const d = new Date(iso)
    const now = new Date()
    const diff = now.getTime() - d.getTime()
    if (diff < 60_000) return 'just now'
    if (diff < 3600_000) return `${Math.floor(diff / 60_000)}m ago`
    if (diff < 86_400_000) return `${Math.floor(diff / 3600_000)}h ago`
    return d.toLocaleDateString()
  }

  function formatDuration(ms?: number): string {
    if (!ms) return ''
    const s = Math.floor(ms / 1000)
    if (s < 60) return `${s}s`
    return `${Math.floor(s / 60)}m ${s % 60}s`
  }
</script>

<div class="session-list">
  <div class="filters">
    <select class="agent-filter" bind:value={filterAgentId} onchange={handleSearch}>
      <option value="">All agents</option>
      {#each $agents as agent}
        <option value={agent.id}>{agent.name}</option>
      {/each}
    </select>
    <div class="search-row">
      <input
        class="text-filter"
        type="text"
        bind:value={textQuery}
        placeholder="Search text content..."
        onkeydown={handleTextKeydown}
      />
      <button class="search-btn" onclick={handleSearch} disabled={searching}>
        {searching ? '…' : '⌕'}
      </button>
    </div>
  </div>

  <div class="list">
    {#if loading}
      <div class="empty">Loading...</div>
    {:else if records.length === 0}
      <div class="empty">No sessions found</div>
    {:else}
      {#each records as record (record.id)}
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div class="session-row" onclick={() => handleSelect(record)} role="button" tabindex="0"
          onkeydown={(e) => e.key === 'Enter' && handleSelect(record)}>
          <div class="row-top">
            <span class="s-agent">{record.agentName}</span>
            <span class="s-inst">#{record.instanceIndex}{record.instanceTag ? ` · ${record.instanceTag}` : ''}</span>
            <span class="s-time">{formatDate(record.startedAt)}</span>
          </div>
          {#if record.prompt}
            <div class="s-prompt">{record.prompt}</div>
          {/if}
          {#if record.durationMs}
            <div class="row-bottom">
              <span class="s-duration">{formatDuration(record.durationMs)}</span>
            </div>
          {/if}
        </div>
      {/each}
    {/if}
  </div>
</div>

<style>
  .session-list {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
  }

  .filters {
    padding: 8px 12px;
    display: flex;
    flex-direction: column;
    gap: 6px;
    border-bottom: 1px solid #313244;
    flex-shrink: 0;
  }

  .agent-filter {
    background: #11111b;
    border: 1px solid #313244;
    border-radius: 4px;
    padding: 5px 8px;
    color: #cdd6f4;
    font-size: 12px;
    outline: none;
    width: 100%;
  }

  .search-row {
    display: flex;
    gap: 4px;
  }

  .text-filter {
    flex: 1;
    background: #11111b;
    border: 1px solid #313244;
    border-radius: 4px;
    padding: 5px 8px;
    color: #cdd6f4;
    font-size: 12px;
    outline: none;
  }

  .text-filter:focus {
    border-color: #89b4fa;
  }

  .search-btn {
    background: #313244;
    border: none;
    border-radius: 4px;
    padding: 4px 10px;
    color: #a6adc8;
    font-size: 14px;
    cursor: pointer;
  }

  .search-btn:disabled {
    opacity: 0.5;
  }

  .list {
    flex: 1;
    overflow-y: auto;
    padding: 4px 8px 12px;
  }

  .empty {
    padding: 24px;
    text-align: center;
    font-size: 12px;
    color: #45475a;
  }

  .session-row {
    padding: 8px 8px;
    border-radius: 6px;
    cursor: pointer;
    margin-bottom: 2px;
    border: 1px solid transparent;
  }

  .session-row:hover {
    background: #1e1e2e;
    border-color: #313244;
  }

  .row-top {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-bottom: 2px;
  }

  .s-agent {
    font-size: 12px;
    font-weight: 600;
    color: #cdd6f4;
  }

  .s-inst {
    font-size: 11px;
    color: #6c7086;
    font-family: monospace;
  }

  .s-time {
    font-size: 11px;
    color: #45475a;
    margin-left: auto;
  }

  .s-prompt {
    font-size: 11px;
    color: #585b70;
    font-family: monospace;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    margin-bottom: 3px;
  }

  .row-bottom {
    display: flex;
    align-items: center;
  }

  .s-duration {
    font-size: 10px;
    font-family: monospace;
    color: #45475a;
  }

</style>
