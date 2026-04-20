<script lang="ts">
  import type { AgentDefinition, AgentInstance } from '../types'
  import { showNewAgentModal, selectedAgentId, selectedInstanceId, showCreateAgentModal, editingAgentId, activeSessionId, sidebarTab } from '../stores/ui'
  import { sessions } from '../stores/sessions'
  import { deleteAgent, loadAgents } from '../stores/agents'
  import { cloneProgress } from '../stores/cloneProgress'
  import { publishLocalAgent, republishMyMarketplaceAgent } from '../stores/marketplace'
  import CronModal from './CronModal.svelte'
  let { agent }: { agent: AgentDefinition } = $props()

  let showCronModal = $state(false)
  let publishing = $state(false)
  let republishing = $state(false)

  // Match on both agentId AND instanceId to avoid cross-agent false positives
  function sessionForInstance(instanceId: string) {
    return $sessions.find((s) => s.agentId === agent.id && s.instanceId === instanceId) ?? null
  }

  function handleLaunchInstance(inst: AgentInstance) {
    if (!inst.ready) return
    if (sessionForInstance(inst.id)) return
    selectedAgentId.set(agent.id)
    selectedInstanceId.set(inst.id)
    showNewAgentModal.set(true)
  }

  function handleEdit(e: MouseEvent) {
    e.stopPropagation()
    editingAgentId.set(agent.id)
    showCreateAgentModal.set(true)
  }

  async function handleDeleteAgent(e: MouseEvent) {
    e.stopPropagation()
    const hasRunningSessions = agent.instances.some((i) => sessionForInstance(i.id))
    if (hasRunningSessions) return
    await deleteAgent(agent.id)
  }

  async function handleAddInstance(e: MouseEvent) {
    e.stopPropagation()
    await window.api.instanceCreate(agent.id)
    await loadAgents()
  }

  async function handlePublish(e: MouseEvent) {
    e.stopPropagation()
    if (publishing) return
    if (!confirm(`Publish "${agent.name}" to the marketplace? Anyone will be able to clone it. Only you can edit or delete it.`)) return
    publishing = true
    try {
      await publishLocalAgent(agent.id)
      await loadAgents()
      sidebarTab.set('marketplace')
    } catch (err) {
      console.error('[agent-card] publish failed:', err)
      alert('Publish failed: ' + (err instanceof Error ? err.message : String(err)))
    } finally {
      publishing = false
    }
  }

  async function handleRepublish(e: MouseEvent) {
    e.stopPropagation()
    if (republishing) return
    republishing = true
    try {
      await republishMyMarketplaceAgent(agent.id)
    } catch (err) {
      console.error('[agent-card] republish failed:', err)
      alert('Republish failed: ' + (err instanceof Error ? err.message : String(err)))
    } finally {
      republishing = false
    }
  }

  async function handleDeleteInstance(e: MouseEvent, instanceId: string) {
    e.stopPropagation()
    if (sessionForInstance(instanceId)) return
    await window.api.instanceDelete(agent.id, instanceId)
    await loadAgents()
  }

  function openInCursor(e: MouseEvent, inst: AgentInstance, repo: string) {
    e.stopPropagation()
    window.api.openInCursor(`${inst.workingDir}/${repo}`)
  }

  function openInTerminal(e: MouseEvent, inst: AgentInstance) {
    e.stopPropagation()
    window.api.openInTerminal(inst.workingDir)
  }

  // Inline tag editing
  let editingTagId = $state<string | null>(null)
  let tagDraft = $state('')

  function startEditTag(e: MouseEvent, inst: AgentInstance) {
    e.stopPropagation()
    editingTagId = inst.id
    tagDraft = inst.tag || ''
  }

  async function commitTag(instanceId: string) {
    editingTagId = null
    await window.api.instanceUpdateTag(agent.id, instanceId, tagDraft)
    await loadAgents()
  }

  let cancellingTag = false

  function handleTagKeydown(e: KeyboardEvent, instanceId: string) {
    if (e.key === 'Enter') commitTag(instanceId)
    if (e.key === 'Escape') { cancellingTag = true; editingTagId = null }
    e.stopPropagation()
  }

  async function handleTagBlur(instanceId: string) {
    if (cancellingTag) { cancellingTag = false; return }
    await commitTag(instanceId)
  }

  const agentTooltip = $derived.by(() => {
    let text = ''
    if (agent.description) text += agent.description
    if (agent.useWhen) text += (text ? '\n' : '') + 'Use when: ' + agent.useWhen
    return text
  })
</script>

<div class="agent-group">
  <!-- Agent header row -->
  <div class="agent-header" title={agentTooltip}>
    <span class="bot-icon">{agent.emoji || '🤖'}</span>
    <span class="agent-name">{agent.name}</span>
    <div class="agent-actions">
      <button class="action-btn" onclick={handleAddInstance} title="Add instance">+</button>
      <button class="action-btn cron-btn" onclick={(e) => { e.stopPropagation(); showCronModal = true }} title="Scheduled jobs">🕐</button>
      {#if !agent.marketplaceAgentId}
        <button
          class="action-btn"
          onclick={handlePublish}
          disabled={publishing}
          title="Publish to marketplace"
        >📤</button>
      {:else}
        <button
          class="action-btn republish-btn"
          onclick={handleRepublish}
          disabled={republishing}
          title="Republish to marketplace (overwrite your published entry)"
        >🔄</button>
      {/if}
      <button class="action-btn" onclick={handleEdit} title="Edit">✏️</button>
      <button
        class="action-btn"
        onclick={handleDeleteAgent}
        title="Delete agent"
        disabled={agent.instances.some((i) => !!sessionForInstance(i.id))}
      >🗑️</button>
    </div>
  </div>

  <!-- Instance rows -->
  <div class="instances">
    {#each agent.instances as inst (inst.id)}
      {@const session = sessionForInstance(inst.id)}
      {@const isRunning = !!session}
      {@const isCloning = !inst.ready}
      {@const launchable = !isRunning && !isCloning}
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        class="instance-block"
        class:launchable
        class:running={isRunning}
        class:cloning={isCloning}
        onclick={() => handleLaunchInstance(inst)}
        role={launchable ? 'button' : undefined}
        tabindex={launchable ? 0 : undefined}
        onkeydown={(e) => e.key === 'Enter' && handleLaunchInstance(inst)}
      >
        <div class="instance-row">
          <span class="inst-play">
            {#if !isRunning && !isCloning}
              <span class="play-btn">▶</span>
            {/if}
          </span>

          <span class="inst-index">#{inst.index}</span>

          {#if editingTagId === inst.id}
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <input
              class="tag-input"
              type="text"
              bind:value={tagDraft}
              onblur={() => handleTagBlur(inst.id)}
              onkeydown={(e) => handleTagKeydown(e, inst.id)}
              onclick={(e) => e.stopPropagation()}
              autofocus
            />
          {:else}
            <span
              class="inst-tag"
              class:empty={!inst.tag}
              onclick={(e) => startEditTag(e, inst)}
              title="Click to rename"
            >{inst.tag || `Instance ${inst.index}`}</span>
          {/if}

          {#if isCloning}
            <span class="cloning-dot">↻</span>
          {/if}

          {#if inst.ready}
            <button class="term-btn" onclick={(e) => openInTerminal(e, inst)} title="Open terminal here">terminal</button>
          {/if}

          <button
            class="del-inst-btn"
            onclick={(e) => handleDeleteInstance(e, inst.id)}
            disabled={isRunning}
            title="Delete instance"
          >🗑️</button>
        </div>

        {#if isCloning && agent.repos.length > 0}
          <div class="clone-progress">
            {#each agent.repos as repo}
              {@const repoStatus = $cloneProgress[inst.id]?.[repo.name] ?? 'pending'}
              <div class="clone-row">
                <span class="clone-icon">
                  {#if repoStatus === 'done'}<span class="done">✓</span>
                  {:else if repoStatus === 'error'}<span class="error">✗</span>
                  {:else if repoStatus === 'cloning'}<span class="spinning">↻</span>
                  {:else}<span class="pending">○</span>
                  {/if}
                </span>
                <span class="clone-label" class:active={repoStatus === 'cloning'}>
                  {repoStatus === 'cloning' ? `Cloning ${repo.name}...` : repo.name}
                </span>
              </div>
            {/each}
          </div>
        {/if}

        {#if inst.ready && agent.repos.length > 0}
          <div class="inst-repos">
            {#each agent.repos as repo}
              <button class="repo-chip" onclick={(e) => openInCursor(e, inst, repo.name)} title="Open in Cursor">
                {repo.name}
              </button>
            {/each}
          </div>
        {/if}
      </div>
    {/each}

    {#if agent.instances.length === 0}
      <div class="no-instances">No instances — click + to create one</div>
    {/if}
  </div>
</div>

<CronModal {agent} bind:visible={showCronModal} />

<style>
  .agent-group {
    margin-bottom: 8px;
    border: 1px solid #313244;
    border-radius: 8px;
    background: #1e1e2e;
    overflow: hidden;
  }

  .agent-header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 10px;
    background: #1e1e2e;
  }

  .bot-icon {
    font-size: 14px;
    flex-shrink: 0;
  }

  .agent-name {
    font-size: 13px;
    font-weight: 600;
    color: #cdd6f4;
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .agent-actions {
    display: flex;
    gap: 2px;
    flex-shrink: 0;
  }

  .action-btn {
    width: 22px;
    height: 22px;
    border-radius: 4px;
    border: none;
    background: transparent;
    font-size: 12px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    color: #6c7086;
  }

  .action-btn:hover:not(:disabled) {
    background: #313244;
    color: #cdd6f4;
  }

  .action-btn:disabled {
    opacity: 0.3;
    cursor: not-allowed;
  }

  .republish-btn {
    color: #f9e2af;
  }

  .republish-btn:hover:not(:disabled) {
    background: color-mix(in srgb, #f9e2af 14%, transparent);
    color: #f9e2af;
  }

  .clone-progress {
    padding: 5px 10px 6px 34px;
    background: #181825;
    border-bottom: 1px solid #1e1e2e;
    display: flex;
    flex-direction: column;
    gap: 3px;
  }

  .clone-row {
    display: flex;
    align-items: center;
    gap: 7px;
    font-size: 11px;
  }

  .clone-icon {
    width: 12px;
    text-align: center;
    flex-shrink: 0;
  }

  .clone-label {
    color: #45475a;
  }

  .clone-label.active {
    color: #89b4fa;
  }

  .done { color: #a6e3a1; }
  .error { color: #f38ba8; }
  .pending { color: #45475a; }

  .spinning {
    display: inline-block;
    animation: spin 1s linear infinite;
    color: #89b4fa;
  }

  .inst-repos {
    display: flex;
    gap: 4px;
    flex-wrap: wrap;
    padding: 4px 10px 6px 34px;
    background: #181825;
    border-bottom: 1px solid #1e1e2e;
  }

  .inst-repos:last-child {
    border-bottom: none;
  }

  .repo-chip {
    font-size: 10px;
    font-family: monospace;
    padding: 2px 7px;
    border-radius: 4px;
    border: 1px solid #313244;
    background: #11111b;
    color: #6c7086;
    cursor: pointer;
  }

  .repo-chip:hover {
    border-color: #89b4fa;
    color: #89b4fa;
  }

  .term-btn {
    background: none;
    border: 1px solid #313244;
    border-radius: 3px;
    font-size: 10px;
    cursor: pointer;
    padding: 1px 5px;
    flex-shrink: 0;
    color: #6c7086;
  }

  .term-btn:hover {
    border-color: #a6e3a1;
    color: #a6e3a1;
  }

  .instances {
    border-top: 1px solid #313244;
  }

  .instance-block {
    border-bottom: 1px solid #1e1e2e;
    background: #181825;
    transition: background 0.1s;
    user-select: none;
  }

  .instance-block:last-child {
    border-bottom: none;
  }

  .instance-block.launchable {
    cursor: pointer;
  }

  .instance-block.launchable:hover {
    background: #1e1e2e;
  }

  .instance-block.running {
    cursor: default;
    background: color-mix(in srgb, #a6e3a1 8%, #181825);
    border-left: 2px solid #a6e3a1aa;
  }

  .instance-block.cloning {
    cursor: default;
    opacity: 0.6;
  }

  .instance-row {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 10px 6px 14px;
  }

  .inst-index {
    font-size: 10px;
    font-family: monospace;
    color: #585b70;
    width: 20px;
    flex-shrink: 0;
  }

  .inst-tag {
    flex: 1;
    font-size: 12px;
    color: #a6adc8;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    cursor: text;
  }

  .inst-tag.empty {
    color: #45475a;
    font-style: italic;
  }

  .tag-input {
    flex: 1;
    background: #11111b;
    border: 1px solid #89b4fa;
    border-radius: 3px;
    padding: 1px 5px;
    color: #cdd6f4;
    font-size: 12px;
    outline: none;
  }

  .cloning-dot {
    font-size: 13px;
    color: #89b4fa;
    display: inline-block;
    animation: spin 1s linear infinite;
  }

  .inst-play {
    width: 14px;
    flex-shrink: 0;
    display: flex;
    align-items: center;
  }

  .play-btn {
    font-size: 9px;
    color: #45475a;
    transition: color 0.1s;
  }

  .instance-block.launchable:hover .play-btn {
    color: #a6e3a1;
  }

  .del-inst-btn {
    background: none;
    border: none;
    font-size: 11px;
    cursor: pointer;
    padding: 0 2px;
    flex-shrink: 0;
  }

  .del-inst-btn:disabled {
    cursor: not-allowed;
  }

  .no-instances {
    padding: 8px 14px;
    font-size: 11px;
    color: #45475a;
    font-style: italic;
  }

  @keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }
</style>
