<script lang="ts">
  import { onMount } from 'svelte'
  import { agents } from '../stores/agents'
  import { spawnSession } from '../stores/sessions'
  import { showNewAgentModal, selectedAgentId, selectedInstanceId } from '../stores/ui'
  import McpBadge from './McpBadge.svelte'
  import type { AgentDefinition, AgentInstance, McpStatusResult } from '../types'

  let argValues = $state<Record<string, string>>({})
  let launching = $state(false)
  let mcpStatuses = $state<McpStatusResult[]>([])
  let mcpLoading = $state(false)

  const agent: AgentDefinition | undefined = $derived(
    $agents.find((a) => a.id === $selectedAgentId)
  )

  const instance: AgentInstance | undefined = $derived(
    agent?.instances.find((i) => i.id === $selectedInstanceId)
  )

  const activeMcpRequirements = $derived(
    agent ? agent.mcpRequirements : []
  )

  // MCPs that are blocking launch (required but not connected)
  const blockedMcps = $derived(
    mcpStatuses.filter((m) => m.status !== 'connected')
  )

  const canLaunch = $derived(
    !launching &&
    (agent?.args.filter((a) => a.required).every((a) => argValues[a.name]?.trim()) ?? true)
  )

  // Init argValues when agent changes
  $effect(() => {
    if (agent) {
      const defaults: Record<string, string> = {}
      for (const arg of agent.args) {
        defaults[arg.name] = arg.default || (arg.options?.[0] ?? '')
      }
      argValues = defaults
      mcpStatuses = []
    }
  })

  // Re-check MCP statuses whenever the active requirements change (driven by arg values)
  $effect(() => {
    const reqs = activeMcpRequirements
    if (reqs.length > 0) {
      mcpLoading = true
      mcpStatuses = []
      window.api.mcpStatuses(reqs).then((statuses) => {
        mcpStatuses = statuses
        mcpLoading = false
      })
    } else {
      mcpStatuses = []
      mcpLoading = false
    }
  })

  function close() {
    showNewAgentModal.set(false)
    selectedAgentId.set(null)
    selectedInstanceId.set(null)
    argValues = {}
    mcpStatuses = []
  }

  async function launch() {
    if (!agent || !instance || !canLaunch) return
    launching = true
    try {
      await spawnSession(agent.id, instance.id, JSON.parse(JSON.stringify(argValues)))
      close()
    } catch (err) {
      console.error('Failed to spawn session:', err)
    } finally {
      launching = false
    }
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') close()
    if (e.key === 'Enter' && e.metaKey && canLaunch) launch()
  }

  async function refreshMcp() {
    if (!agent || activeMcpRequirements.length === 0) return
    mcpLoading = true
    mcpStatuses = await window.api.mcpStatuses(activeMcpRequirements)
    mcpLoading = false
  }
</script>

{#if $showNewAgentModal && agent}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="overlay" onclick={close} onkeydown={handleKeydown}>
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="modal" onclick={(e) => e.stopPropagation()} onkeydown={handleKeydown}>
      <div class="modal-header">
        <h2>Launch {agent.name} <span class="inst-label">#{instance?.index}{instance?.tag ? ` · ${instance.tag}` : ''}</span></h2>
        <button class="close-btn" onclick={close}>x</button>
      </div>

      {#if agent.description}
        <p class="description">{agent.description}</p>
      {/if}

      {#if activeMcpRequirements.length > 0}
        <div class="section">
          <div class="section-title-row">
            <h3>Required MCP Servers</h3>
            <button class="refresh-btn" onclick={refreshMcp} disabled={mcpLoading} title="Re-check statuses">
              {mcpLoading ? '…' : '↻'}
            </button>
          </div>
          <div class="mcp-list">
            {#if mcpLoading}
              <span class="mcp-checking">Checking...</span>
            {:else}
              {#each mcpStatuses as mcp}
                <McpBadge name={mcp.name} status={mcp.status} />
              {/each}
            {/if}
          </div>
          {#if !mcpLoading && blockedMcps.length > 0}
            <div class="mcp-warning">
              {#each blockedMcps as mcp}
                <p>
                  {#if mcp.status === 'needs-auth'}
                    <strong>{mcp.name}</strong> needs re-authentication. Open Claude Code and reconnect it, then click ↻ above.
                  {:else}
                    <strong>{mcp.name}</strong> has never been connected. Open Claude Code → Settings → MCP Servers to add it.
                  {/if}
                </p>
              {/each}
            </div>
          {/if}
        </div>
      {/if}

      {#if agent.args.length > 0}
        <div class="section">
          <h3>Arguments</h3>
          {#each agent.args as arg}
            <div class="arg-field">
              <label for={arg.name}>
                {arg.name}
                {#if arg.required}<span class="required">*</span>{/if}
              </label>
              <p class="arg-desc">{arg.description}</p>
              {#if arg.options && arg.options.length > 0}
                <div class="option-group">
                  {#each arg.options as opt}
                    <label class="option-btn" class:active={argValues[arg.name] === opt}>
                      <input type="radio" name={arg.name} value={opt} bind:group={argValues[arg.name]} />
                      {opt}
                    </label>
                  {/each}
                </div>
              {:else}
                <input
                  id={arg.name}
                  type="text"
                  bind:value={argValues[arg.name]}
                  placeholder={arg.default || ''}
                />
              {/if}
            </div>
          {/each}
        </div>
      {/if}

      <div class="modal-footer">
        <button class="cancel-btn" onclick={close}>Cancel</button>
        <button class="launch-btn" onclick={launch} disabled={!canLaunch}
          title={blockedMcps.length > 0 ? `Connect ${blockedMcps.map(m => m.name).join(', ')} first` : ''}>
          {launching ? 'Launching...' : 'Launch'}
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  .overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.6);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 100;
  }

  .modal {
    background: #1e1e2e;
    border: 1px solid #313244;
    border-radius: 12px;
    width: 480px;
    max-height: 80vh;
    overflow-y: auto;
    padding: 24px;
  }

  .modal-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 12px;
  }

  .modal-header h2 {
    font-size: 18px;
    font-weight: 600;
    color: #cdd6f4;
    margin: 0;
  }

  .inst-label {
    font-size: 12px;
    font-weight: 400;
    color: #6c7086;
  }

  .close-btn {
    background: none;
    border: none;
    color: #6c7086;
    font-size: 18px;
    cursor: pointer;
    padding: 4px 8px;
    border-radius: 6px;
  }

  .close-btn:hover {
    background: #313244;
    color: #cdd6f4;
  }

  .description {
    font-size: 13px;
    color: #a6adc8;
    margin: 0 0 16px;
    line-height: 1.5;
  }

  .section {
    margin-bottom: 16px;
  }

  .section-title-row {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 8px;
  }

  .section h3 {
    font-size: 12px;
    font-weight: 600;
    color: #a6adc8;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin: 0;
  }

  .refresh-btn {
    background: none;
    border: none;
    color: #6c7086;
    font-size: 14px;
    cursor: pointer;
    padding: 0 4px;
    line-height: 1;
  }

  .refresh-btn:hover:not(:disabled) {
    color: #cdd6f4;
  }

  .mcp-list {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
    margin-bottom: 6px;
  }

  .mcp-checking {
    font-size: 11px;
    color: #45475a;
  }

  .mcp-warning {
    margin-top: 8px;
    padding: 8px 10px;
    background: #f38ba811;
    border: 1px solid #f38ba833;
    border-radius: 6px;
  }

  .mcp-warning p {
    font-size: 12px;
    color: #f38ba8;
    margin: 0 0 4px;
    line-height: 1.5;
  }

  .mcp-warning p:last-child {
    margin-bottom: 0;
  }

  .arg-field {
    margin-bottom: 12px;
  }

  .arg-field label {
    display: block;
    font-size: 13px;
    font-weight: 500;
    color: #cdd6f4;
    margin-bottom: 2px;
  }

  .required {
    color: #f38ba8;
  }

  .arg-desc {
    font-size: 11px;
    color: #6c7086;
    margin: 0 0 6px;
  }

  .arg-field input {
    width: 100%;
    background: #11111b;
    border: 1px solid #313244;
    border-radius: 6px;
    padding: 8px 10px;
    color: #cdd6f4;
    font-size: 13px;
    outline: none;
    box-sizing: border-box;
  }

  .arg-field input:focus {
    border-color: #89b4fa;
  }

  .option-group {
    display: flex;
    gap: 8px;
  }

  .option-btn {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 8px 12px;
    border-radius: 6px;
    border: 1px solid #313244;
    background: #11111b;
    color: #a6adc8;
    font-size: 13px;
    cursor: pointer;
    user-select: none;
  }

  .option-btn input {
    display: none;
  }

  .option-btn:hover {
    border-color: #45475a;
    color: #cdd6f4;
  }

  .option-btn.active {
    border-color: #89b4fa;
    background: color-mix(in srgb, #89b4fa 12%, #11111b);
    color: #89b4fa;
    font-weight: 500;
  }

  .modal-footer {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 20px;
  }

  .cancel-btn {
    padding: 8px 16px;
    border-radius: 8px;
    border: 1px solid #313244;
    background: transparent;
    color: #a6adc8;
    font-size: 13px;
    cursor: pointer;
  }

  .cancel-btn:hover {
    background: #313244;
  }

  .launch-btn {
    padding: 8px 20px;
    border-radius: 8px;
    border: none;
    background: #89b4fa;
    color: #1e1e2e;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
  }

  .launch-btn:hover:not(:disabled) {
    background: #74c7ec;
  }

  .launch-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
</style>
