<script lang="ts">
  import { onMount } from 'svelte'
  import {
    marketplaceAgents,
    marketplaceLoading,
    loadMarketplace
  } from '../stores/marketplace'
  import MarketplaceAgentCard from './MarketplaceAgentCard.svelte'
  import MarketplaceEditModal from './MarketplaceEditModal.svelte'

  let search = $state('')
  let sortBy = $state<'stars' | 'recent' | 'mine'>('stars')

  const visibleAgents = $derived.by(() => {
    const q = search.trim().toLowerCase()
    let list = $marketplaceAgents
    if (q) {
      list = list.filter(
        (a) =>
          a.name.toLowerCase().includes(q) ||
          (a.description || '').toLowerCase().includes(q) ||
          (a.use_when || '').toLowerCase().includes(q)
      )
    }
    const sorted = [...list]
    if (sortBy === 'stars') sorted.sort((a, b) => b.star_count - a.star_count)
    else if (sortBy === 'mine') sorted.sort((a, b) => Number(b.mine) - Number(a.mine))
    else sorted.sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
    return sorted
  })

  onMount(() => {
    loadMarketplace()
  })
</script>

<div class="mp-view">
  <div class="mp-filters">
    <input
      class="mp-search"
      type="text"
      placeholder="Search agents…"
      bind:value={search}
    />
    <select class="mp-sort" bind:value={sortBy}>
      <option value="stars">Most starred</option>
      <option value="recent">Recently updated</option>
      <option value="mine">Mine first</option>
    </select>
  </div>

  <div class="mp-list">
    {#if $marketplaceLoading && $marketplaceAgents.length === 0}
      <div class="mp-empty">Loading marketplace…</div>
    {:else if visibleAgents.length === 0}
      <div class="mp-empty">
        {#if search}
          No agents matching "{search}"
        {:else}
          No agents in the marketplace yet.
        {/if}
      </div>
    {:else}
      {#each visibleAgents as agent (agent.id)}
        <MarketplaceAgentCard {agent} />
      {/each}
    {/if}
  </div>
</div>

<MarketplaceEditModal />

<style>
  .mp-view {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
  }

  .mp-filters {
    display: flex;
    gap: 6px;
    padding: 8px 12px;
    flex-shrink: 0;
    border-bottom: 1px solid #313244;
  }

  .mp-search, .mp-sort {
    background: #11111b;
    border: 1px solid #313244;
    border-radius: 4px;
    padding: 4px 8px;
    color: #cdd6f4;
    font-size: 11px;
    outline: none;
  }

  .mp-search {
    flex: 1;
    min-width: 0;
  }

  .mp-sort {
    flex-shrink: 0;
  }

  .mp-search:focus, .mp-sort:focus {
    border-color: #cba6f7;
  }

  .mp-list {
    flex: 1;
    overflow-y: auto;
    padding: 10px 12px 16px;
  }

  .mp-empty {
    padding: 32px 12px;
    text-align: center;
    font-size: 12px;
    color: #45475a;
    line-height: 1.6;
  }
</style>
