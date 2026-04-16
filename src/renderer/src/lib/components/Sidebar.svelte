<script lang="ts">
  import { agents, loadAgents } from '../stores/agents'
  import { sidebarCollapsed, showCreateAgentModal } from '../stores/ui'
  import AgentCard from './AgentCard.svelte'
  import SessionList from './SessionList.svelte'
  import { onMount } from 'svelte'

  let tab = $state<'agents' | 'sessions'>('agents')

  onMount(() => {
    loadAgents()
  })
</script>

<aside class="sidebar" class:collapsed={$sidebarCollapsed}>
  <div class="sidebar-header">
    <div class="tabs">
      <button class="tab-btn" class:active={tab === 'agents'} onclick={() => tab = 'agents'}>Agents</button>
      <button class="tab-btn" class:active={tab === 'sessions'} onclick={() => tab = 'sessions'}>Sessions</button>
    </div>
    <div class="header-actions">
      {#if tab === 'agents' && !$sidebarCollapsed}
        <button class="create-btn" onclick={() => showCreateAgentModal.set(true)} title="Create agent">+</button>
      {/if}
      <button
        class="collapse-btn"
        onclick={() => sidebarCollapsed.update((v) => !v)}
        title={$sidebarCollapsed ? 'Expand' : 'Collapse'}
      >{$sidebarCollapsed ? '>' : '<'}</button>
    </div>
  </div>

  {#if !$sidebarCollapsed}
    {#if tab === 'agents'}
      <div class="agent-list">
        {#if $agents.length === 0}
          <div class="empty">
            <p>No agents yet.</p>
            <button class="create-first-btn" onclick={() => showCreateAgentModal.set(true)}>
              Create your first agent
            </button>
          </div>
        {:else}
          {#each $agents as agent (agent.id)}
            <AgentCard {agent} />
          {/each}
        {/if}
      </div>
    {:else}
      <SessionList />
    {/if}
  {/if}
</aside>

<style>
  .sidebar {
    width: 280px;
    min-width: 280px;
    background: #181825;
    border-right: 1px solid #313244;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    transition: width 0.2s, min-width 0.2s;
  }

  .sidebar.collapsed {
    width: 44px;
    min-width: 44px;
  }

  .sidebar-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 8px 12px 0;
    gap: 8px;
    border-bottom: 1px solid #313244;
  }

  .tabs {
    display: flex;
    gap: 2px;
    flex: 1;
  }

  .tab-btn {
    flex: 1;
    padding: 6px 8px;
    border: none;
    border-bottom: 2px solid transparent;
    background: transparent;
    color: #6c7086;
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
  }

  .tab-btn:hover {
    color: #a6adc8;
  }

  .tab-btn.active {
    color: #cdd6f4;
    border-bottom-color: #89b4fa;
  }

  .header-actions {
    display: flex;
    gap: 4px;
    -webkit-app-region: no-drag;
    flex-shrink: 0;
    padding-bottom: 4px;
  }

  .create-btn {
    width: 26px;
    height: 26px;
    border-radius: 6px;
    border: 1px solid #45475a;
    background: transparent;
    color: #a6e3a1;
    font-size: 16px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    line-height: 1;
  }

  .create-btn:hover {
    background: #313244;
    border-color: #a6e3a1;
  }

  .collapse-btn {
    background: none;
    border: none;
    color: #6c7086;
    cursor: pointer;
    font-size: 14px;
    padding: 4px;
  }

  .collapse-btn:hover {
    color: #cdd6f4;
  }

  .agent-list {
    flex: 1;
    overflow-y: auto;
    padding: 8px 12px 12px;
  }

  .empty {
    text-align: center;
    padding: 30px 8px;
  }

  .empty p {
    font-size: 13px;
    color: #6c7086;
    margin-bottom: 12px;
  }

  .create-first-btn {
    padding: 8px 16px;
    border-radius: 8px;
    border: 1px dashed #45475a;
    background: transparent;
    color: #a6e3a1;
    font-size: 13px;
    cursor: pointer;
  }

  .create-first-btn:hover {
    background: #1e1e2e;
    border-color: #a6e3a1;
  }
</style>
