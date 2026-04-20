<script lang="ts">
  import { marketplaceAgents, updateMyMarketplaceAgent } from '../stores/marketplace'
  import { loadAgents } from '../stores/agents'
  import { editingMarketplaceAgentId } from '../stores/ui'
  import type { AgentArg, RepoEntry } from '../types'

  let name = $state('')
  let emoji = $state('🤖')
  let description = $state('')
  let useWhen = $state('')
  let claudeMdBody = $state('')
  let args = $state<AgentArg[]>([])
  let mcpRequirements = $state<string[]>([])
  let repos = $state<RepoEntry[]>([])
  let allowedCommands = $state<string[]>([])
  let newCommand = $state('')
  let newMcp = $state('')
  let saving = $state(false)
  let error = $state('')

  const editingAgent = $derived(
    $editingMarketplaceAgentId ? $marketplaceAgents.find((a) => a.id === $editingMarketplaceAgentId) : null
  )

  function extractBody(claudeMd: string | null | undefined): string {
    if (!claudeMd) return ''
    const withRepos = claudeMd.match(/^---\n[\s\S]*?\n---\n+(?:## Repos[\s\S]*?\n\n)?# Agent Instructions\n+([\s\S]*)$/)
    if (withRepos) return withRepos[1]
    const bare = claudeMd.match(/^---\n[\s\S]*?\n---\n+([\s\S]*)$/)
    return bare ? bare[1] : claudeMd
  }

  $effect(() => {
    if (editingAgent) {
      // Defense-in-depth: if someone opens this for a non-owned agent, close.
      if (!editingAgent.mine) {
        editingMarketplaceAgentId.set(null)
        return
      }
      name = editingAgent.name
      emoji = editingAgent.emoji || '🤖'
      description = editingAgent.description || ''
      useWhen = editingAgent.use_when || ''
      claudeMdBody = extractBody(editingAgent.claude_md_content)
      args = [...(editingAgent.args || [])]
      mcpRequirements = [...(editingAgent.mcp_requirements || [])]
      repos = [...(editingAgent.repos || [])]
      allowedCommands = [...(editingAgent.allowed_commands || [])]
      error = ''
    }
  })

  function close() {
    editingMarketplaceAgentId.set(null)
    error = ''
  }

  function addArg() { args = [...args, { name: '', description: '', required: false }] }
  function removeArg(i: number) { args = args.filter((_, idx) => idx !== i) }

  function addMcp() {
    const v = newMcp.trim()
    if (v && !mcpRequirements.includes(v)) {
      mcpRequirements = [...mcpRequirements, v]
      newMcp = ''
    }
  }
  function removeMcp(i: number) { mcpRequirements = mcpRequirements.filter((_, idx) => idx !== i) }

  function addCommand() {
    const v = newCommand.trim()
    if (v && !allowedCommands.includes(v)) {
      allowedCommands = [...allowedCommands, v]
      newCommand = ''
    }
  }
  function removeCommand(i: number) { allowedCommands = allowedCommands.filter((_, idx) => idx !== i) }

  async function handleSave() {
    if (!$editingMarketplaceAgentId) return
    if (!name.trim()) {
      error = 'Name is required'
      return
    }
    saving = true
    error = ''
    try {
      await updateMyMarketplaceAgent($editingMarketplaceAgentId, {
        name: name.trim(),
        emoji: emoji.trim() || '🤖',
        description: description.trim(),
        useWhen: useWhen.trim(),
        claudeMdBody: claudeMdBody.trim(),
        args: args.filter((a) => a.name.trim()),
        mcpRequirements,
        allowedCommands,
        repos
      })
      await loadAgents()
      close()
    } catch (err) {
      console.error('[marketplace edit] save failed:', err)
      error = err instanceof Error ? err.message : String(err)
    } finally {
      saving = false
    }
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') close()
  }

  function autoExpand(e: Event) {
    const el = e.target as HTMLTextAreaElement
    el.style.height = 'auto'
    el.style.height = el.scrollHeight + 'px'
  }
</script>

{#if editingAgent}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="overlay" onclick={close} onkeydown={handleKeydown}>
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="modal" onclick={(e) => e.stopPropagation()} onkeydown={handleKeydown}>
      <div class="modal-header">
        <div class="modal-title">
          <h2>Edit my published agent</h2>
          <span class="wiki-note">Updates your marketplace entry. Other users can clone again to pick up changes.</span>
        </div>
        <button class="close-btn" onclick={close}>x</button>
      </div>

      <div class="form">
        <div class="field">
          <label for="mp-name">Name</label>
          <div class="name-row">
            <input class="emoji-input" type="text" bind:value={emoji} maxlength="2" />
            <input id="mp-name" type="text" bind:value={name} placeholder="agent-name" />
          </div>
        </div>

        <div class="field">
          <label for="mp-desc">Description</label>
          <textarea id="mp-desc" bind:value={description} oninput={autoExpand} rows="1" class="auto-expand"></textarea>
        </div>

        <div class="field">
          <label for="mp-use">Use when</label>
          <textarea id="mp-use" bind:value={useWhen} oninput={autoExpand} rows="1" class="auto-expand"></textarea>
        </div>

        <div class="field">
          <label for="mp-body">CLAUDE.md Instructions</label>
          <textarea id="mp-body" bind:value={claudeMdBody} rows="14"></textarea>
        </div>

        <div class="section">
          <div class="section-header">
            <h3>Arguments</h3>
            <button class="add-btn" onclick={addArg}>+ Add</button>
          </div>
          {#each args as arg, i}
            <div class="arg-block">
              <div class="arg-row-top">
                <input type="text" bind:value={arg.name} placeholder="Arg name" class="arg-name" />
                <input type="text" bind:value={arg.description} placeholder="Description" class="arg-desc" />
                <button class="remove-btn" onclick={() => removeArg(i)}>x</button>
              </div>
              <div class="arg-row-bottom">
                <input type="text" bind:value={arg.default} placeholder="Default" class="arg-field-sm" />
                <input
                  type="text"
                  value={arg.options?.join(', ') ?? ''}
                  oninput={(e) => {
                    const v = e.currentTarget.value
                    arg.options = v ? v.split(',').map((s) => s.trim()).filter(Boolean) : undefined
                  }}
                  placeholder="Options: a, b, c"
                  class="arg-field-sm"
                  style="flex: 1"
                />
                <label class="arg-required">
                  <input type="checkbox" bind:checked={arg.required} />
                  Required
                </label>
              </div>
            </div>
          {/each}
        </div>

        <div class="section">
          <div class="section-header">
            <h3>MCP Requirements</h3>
          </div>
          <div class="mcp-input-row">
            <input type="text" bind:value={newMcp} placeholder="e.g. Linear" onkeydown={(e) => e.key === 'Enter' && addMcp()} />
            <button class="add-btn" onclick={addMcp}>+ Add</button>
          </div>
          {#if mcpRequirements.length > 0}
            <div class="mp-tags">
              {#each mcpRequirements as mcp, i}
                <span class="mp-tag">{mcp}<button class="tag-remove" onclick={() => removeMcp(i)}>x</button></span>
              {/each}
            </div>
          {/if}
        </div>

        <div class="section">
          <div class="section-header">
            <h3>Allowed Commands</h3>
          </div>
          <div class="mcp-input-row">
            <input type="text" bind:value={newCommand} placeholder="Bash(git:*)" onkeydown={(e) => e.key === 'Enter' && addCommand()} />
            <button class="add-btn" onclick={addCommand}>+ Add</button>
          </div>
          {#if allowedCommands.length > 0}
            <div class="mp-tags">
              {#each allowedCommands as cmd, i}
                <span class="mp-tag cmd">{cmd}<button class="tag-remove" onclick={() => removeCommand(i)}>x</button></span>
              {/each}
            </div>
          {/if}
        </div>
      </div>

      <div class="modal-footer">
        {#if error}<span class="footer-error">{error}</span>{/if}
        <button class="cancel-btn" onclick={close} disabled={saving}>Cancel</button>
        <button class="save-btn" onclick={handleSave} disabled={saving}>
          {saving ? 'Saving…' : 'Save changes'}
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
    width: 640px;
    max-width: calc(100vw - 40px);
    max-height: 85vh;
    overflow-y: auto;
    padding: 24px;
    box-sizing: border-box;
  }

  .modal-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    margin-bottom: 16px;
  }

  .modal-title h2 {
    font-size: 18px;
    font-weight: 600;
    color: #cdd6f4;
    margin: 0;
  }

  .wiki-note {
    font-size: 11px;
    color: #cba6f7;
    display: block;
    margin-top: 2px;
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

  .close-btn:hover { background: #313244; color: #cdd6f4; }

  .form { display: flex; flex-direction: column; gap: 14px; }

  .field { display: flex; flex-direction: column; gap: 4px; }

  .field label {
    font-size: 12px;
    font-weight: 500;
    color: #a6adc8;
  }

  .name-row { display: flex; gap: 6px; }
  .name-row input[id="mp-name"] { flex: 1; }

  .emoji-input {
    width: 42px;
    text-align: center;
    font-size: 18px;
    padding: 4px 6px !important;
  }

  .field input, .field textarea {
    background: #11111b;
    border: 1px solid #313244;
    border-radius: 6px;
    padding: 8px 10px;
    color: #cdd6f4;
    font-size: 13px;
    outline: none;
    font-family: inherit;
  }

  .field textarea {
    font-family: 'SF Mono', 'Menlo', monospace;
    font-size: 12px;
    line-height: 1.5;
    resize: vertical;
  }

  .field input:focus, .field textarea:focus { border-color: #cba6f7; }

  .field textarea.auto-expand {
    resize: none;
    overflow: hidden;
    min-height: 34px;
    font-family: inherit;
    font-size: 13px;
    line-height: 1.5;
  }

  .section {
    border-top: 1px solid #313244;
    padding-top: 12px;
  }

  .section-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 8px;
  }

  .section-header h3 {
    font-size: 12px;
    font-weight: 600;
    color: #a6adc8;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin: 0;
  }

  .add-btn {
    background: #313244;
    border: none;
    border-radius: 4px;
    padding: 3px 10px;
    color: #cba6f7;
    font-size: 11px;
    cursor: pointer;
  }

  .add-btn:hover { background: #45475a; }

  .arg-block {
    margin-bottom: 8px;
    padding: 8px 10px;
    background: #11111b;
    border: 1px solid #313244;
    border-radius: 6px;
  }

  .arg-row-top { display: flex; gap: 6px; align-items: center; margin-bottom: 6px; }

  .arg-name {
    width: 140px;
    flex-shrink: 0;
    background: #181825 !important;
    font-weight: 500;
  }

  .arg-desc {
    flex: 1;
    min-width: 0;
    background: #181825 !important;
  }

  .arg-row-bottom { display: flex; gap: 6px; align-items: center; }

  .arg-field-sm {
    background: #181825 !important;
    width: 80px;
    font-size: 11px;
    padding: 4px 8px !important;
  }

  .arg-required {
    font-size: 11px;
    color: #6c7086;
    display: flex;
    align-items: center;
    gap: 3px;
    white-space: nowrap;
    flex-shrink: 0;
  }

  .remove-btn {
    background: none;
    border: none;
    color: #585b70;
    cursor: pointer;
    font-size: 13px;
    padding: 2px 4px;
    border-radius: 4px;
  }

  .remove-btn:hover { color: #f38ba8; background: #313244; }

  .mcp-input-row { display: flex; gap: 6px; margin-bottom: 8px; }

  .mcp-input-row input {
    flex: 1;
    background: #11111b;
    border: 1px solid #313244;
    border-radius: 4px;
    padding: 5px 8px;
    color: #cdd6f4;
    font-size: 12px;
    outline: none;
  }

  .mp-tags { display: flex; gap: 6px; flex-wrap: wrap; }

  .mp-tag {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 12px;
    padding: 3px 8px;
    border-radius: 6px;
    background: #313244;
    color: #cba6f7;
  }

  .mp-tag.cmd {
    color: #a6e3a1;
    font-family: monospace;
    font-size: 11px;
  }

  .tag-remove {
    background: none;
    border: none;
    color: #585b70;
    cursor: pointer;
    font-size: 11px;
    padding: 0 2px;
    line-height: 1;
  }

  .tag-remove:hover { color: #f38ba8; }

  .modal-footer {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 20px;
    align-items: center;
  }

  .footer-error {
    font-size: 11px;
    color: #f38ba8;
    margin-right: auto;
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

  .cancel-btn:hover { background: #313244; }

  .save-btn {
    padding: 8px 20px;
    border-radius: 8px;
    border: none;
    background: #cba6f7;
    color: #1e1e2e;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
  }

  .save-btn:hover:not(:disabled) { background: #b4a0e8; }
  .save-btn:disabled { opacity: 0.6; cursor: not-allowed; }
</style>
