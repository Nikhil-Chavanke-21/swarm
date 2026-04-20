<script lang="ts">
  import type { MarketplaceAgent } from '../stores/marketplace'
  import {
    toggleStar,
    cloneMarketplaceAgent,
    deleteMyMarketplaceAgent,
    republishMyMarketplaceAgent
  } from '../stores/marketplace'
  import { loadAgents } from '../stores/agents'
  import { editingMarketplaceAgentId } from '../stores/ui'

  let { agent }: { agent: MarketplaceAgent } = $props()

  let busy = $state(false)

  async function handleStar(e: MouseEvent) {
    e.stopPropagation()
    await toggleStar(agent.id, agent.starred_by_me)
  }

  async function handleClone(e: MouseEvent) {
    e.stopPropagation()
    if (busy) return
    busy = true
    try {
      await cloneMarketplaceAgent(agent.id)
      await loadAgents()
    } catch (err) {
      console.error('[marketplace] clone failed:', err)
      alert('Clone failed: ' + (err instanceof Error ? err.message : String(err)))
    } finally {
      busy = false
    }
  }

  function handleEdit(e: MouseEvent) {
    e.stopPropagation()
    if (!agent.mine) return
    editingMarketplaceAgentId.set(agent.id)
  }

  async function handleDelete(e: MouseEvent) {
    e.stopPropagation()
    if (busy || !agent.mine) return
    if (!confirm(`Delete "${agent.name}" from the marketplace? This does not affect users who already cloned it.`)) return
    busy = true
    try {
      await deleteMyMarketplaceAgent(agent.id)
      await loadAgents()
    } catch (err) {
      console.error('[marketplace] delete failed:', err)
      alert('Delete failed: ' + (err instanceof Error ? err.message : String(err)))
    } finally {
      busy = false
    }
  }

  async function handleRepublish(e: MouseEvent) {
    e.stopPropagation()
    if (busy || !agent.mine || !agent.my_personal_agent_id) return
    busy = true
    try {
      await republishMyMarketplaceAgent(agent.my_personal_agent_id)
    } catch (err) {
      console.error('[marketplace] republish failed:', err)
      alert('Republish failed: ' + (err instanceof Error ? err.message : String(err)))
    } finally {
      busy = false
    }
  }

  const tooltip = $derived.by(() => {
    let text = agent.description || ''
    if (agent.use_when) text += (text ? '\n\nUse when: ' : 'Use when: ') + agent.use_when
    return text
  })
</script>

<div class="mp-card" class:mine={agent.mine} title={tooltip}>
  <div class="mp-row">
    <span class="mp-emoji">{agent.emoji || '🤖'}</span>
    <div class="mp-main">
      <div class="mp-name-row">
        <span class="mp-name">{agent.name}</span>
        {#if agent.mine}
          <span class="mine-badge" title="You own this entry">mine</span>
        {/if}
        <button class="mp-star" class:starred={agent.starred_by_me} onclick={handleStar} title={agent.starred_by_me ? 'Unstar' : 'Star'}>
          <span class="star-icon">{agent.starred_by_me ? '★' : '☆'}</span>
          <span class="star-count">{agent.star_count}</span>
        </button>
      </div>
      {#if agent.description}
        <div class="mp-desc">{agent.description}</div>
      {/if}
    </div>
  </div>

  <div class="mp-actions">
    <button class="mp-btn clone" onclick={handleClone} disabled={busy} title="Clone a detached copy into your agents">
      {busy ? '…' : 'Clone'}
    </button>

    {#if agent.mine}
      {#if agent.my_personal_agent_id}
        <button class="mp-btn republish" onclick={handleRepublish} disabled={busy} title="Push your personal agent's latest content to this entry">
          Republish
        </button>
      {/if}
      <button class="mp-btn edit" onclick={handleEdit} disabled={busy} title="Edit your published entry">Edit</button>
      <button class="mp-btn delete-bin" onclick={handleDelete} disabled={busy} title="Delete this entry from the marketplace">🗑️</button>
    {/if}
  </div>
</div>

<style>
  .mp-card {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 10px 12px;
    background: #1e1e2e;
    border: 1px solid #313244;
    border-radius: 8px;
    margin-bottom: 8px;
  }

  .mp-card:hover {
    border-color: #45475a;
  }

  .mp-card.mine {
    border-color: color-mix(in srgb, #a6e3a1 30%, #313244);
  }

  .mp-row {
    display: flex;
    gap: 10px;
    align-items: flex-start;
  }

  .mp-emoji {
    font-size: 18px;
    flex-shrink: 0;
    line-height: 1.1;
  }

  .mp-main {
    flex: 1;
    min-width: 0;
  }

  .mp-name-row {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .mp-name {
    font-size: 13px;
    font-weight: 600;
    color: #cdd6f4;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex: 1;
  }

  .mine-badge {
    font-size: 9px;
    color: #a6e3a1;
    padding: 1px 5px;
    border-radius: 3px;
    border: 1px solid color-mix(in srgb, #a6e3a1 40%, transparent);
    background: color-mix(in srgb, #a6e3a1 8%, transparent);
    text-transform: uppercase;
    letter-spacing: 0.5px;
    flex-shrink: 0;
  }

  .mp-star {
    background: none;
    border: 1px solid #313244;
    border-radius: 4px;
    padding: 1px 6px;
    color: #6c7086;
    font-size: 11px;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: 3px;
    flex-shrink: 0;
  }

  .mp-star:hover {
    border-color: #f9e2af;
    color: #f9e2af;
  }

  .mp-star.starred {
    color: #f9e2af;
    border-color: #f9e2af;
    background: color-mix(in srgb, #f9e2af 12%, transparent);
  }

  .star-icon {
    font-size: 12px;
    line-height: 1;
  }

  .star-count {
    font-family: monospace;
    font-size: 10px;
  }

  .mp-desc {
    font-size: 11px;
    color: #6c7086;
    line-height: 1.4;
    margin-top: 2px;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .mp-actions {
    display: flex;
    gap: 4px;
    align-items: center;
    justify-content: flex-end;
    flex-wrap: wrap;
  }

  .mp-btn {
    font-size: 11px;
    padding: 3px 8px;
    border-radius: 4px;
    cursor: pointer;
    border: 1px solid #313244;
    background: transparent;
    color: #a6adc8;
  }

  .mp-btn:hover:not(:disabled) {
    background: #313244;
    color: #cdd6f4;
  }

  .mp-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .mp-btn.clone {
    color: #a6e3a1;
    border-color: color-mix(in srgb, #a6e3a1 40%, transparent);
  }

  .mp-btn.clone:hover:not(:disabled) {
    background: color-mix(in srgb, #a6e3a1 12%, transparent);
  }

  .mp-btn.republish {
    color: #f9e2af;
    border-color: color-mix(in srgb, #f9e2af 40%, transparent);
  }

  .mp-btn.republish:hover:not(:disabled) {
    background: color-mix(in srgb, #f9e2af 12%, transparent);
  }

  .mp-btn.edit {
    color: #89b4fa;
    border-color: color-mix(in srgb, #89b4fa 40%, transparent);
  }

  .mp-btn.edit:hover:not(:disabled) {
    background: color-mix(in srgb, #89b4fa 12%, transparent);
  }

  .mp-btn.delete-bin {
    color: #f38ba8;
    border-color: color-mix(in srgb, #f38ba8 40%, transparent);
    padding: 3px 7px;
    font-size: 13px;
    line-height: 1;
  }

  .mp-btn.delete-bin:hover:not(:disabled) {
    background: color-mix(in srgb, #f38ba8 12%, transparent);
  }
</style>
