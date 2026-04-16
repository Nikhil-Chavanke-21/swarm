<script lang="ts">
  import { agents, createAgent, updateAgent } from '../stores/agents'
  import { showCreateAgentModal, editingAgentId } from '../stores/ui'
  import type { AgentArg, RepoEntry } from '../types'

  let name = $state('')
  let emoji = $state('🤖')
  let description = $state('')
  let useWhen = $state('')
  let claudeMdBody = $state('')
  let args = $state<AgentArg[]>([])
  let mcpRequirements = $state<string[]>([])
  let repos = $state<RepoEntry[]>([])
  let packagePerms = $state<string[]>([])
  let userPerms = $state<string[]>([])
  let newCommand = $state('')
  let newMcp = $state('')
  let saving = $state(false)
  let cloneStatus = $state<Record<string, 'cloning' | 'done' | 'error'>>({})
  let cloneError = $state<Record<string, string>>({})

  import { onMount, onDestroy } from 'svelte'
  let cleanupCloneProgress: (() => void) | null = null

  onMount(() => {
    cleanupCloneProgress = window.api.onCloneProgress(({ repo, status, error }) => {
      cloneStatus = { ...cloneStatus, [repo]: status as 'cloning' | 'done' | 'error' }
      if (error) {
        cloneError = { ...cloneError, [repo]: error }
      }
    })
  })

  onDestroy(() => {
    cleanupCloneProgress?.()
  })

  const COMMON_PERMISSIONS = [
    'Bash(cd:*)',
    'Bash(git checkout:*)',
    'Bash(git pull:*)',
    'Bash(git push:*)',
    'Bash(git merge:*)',
    'Bash(git add:*)',
    'Bash(git commit:*)',
    'Bash(yarn install:*)',
    'Bash(yarn build:*)',
    'Bash(npm install:*)',
    'Bash(npm run:*)',
  ]

  function addCommand() {
    const val = newCommand.trim()
    if (val && !userPerms.includes(val)) {
      userPerms = [...userPerms, val]
      newCommand = ''
    }
  }

  function removeUserPerm(index: number) {
    userPerms = userPerms.filter((_, i) => i !== index)
  }

  function togglePackagePerm(perm: string) {
    if (packagePerms.includes(perm)) {
      packagePerms = packagePerms.filter((c) => c !== perm)
    } else {
      packagePerms = [...packagePerms, perm]
    }
  }

  const allowAll = $derived(userPerms.includes('Bash(*)'))

  function toggleAllowAll() {
    if (allowAll) {
      userPerms = userPerms.filter((c) => c !== 'Bash(*)')
    } else {
      userPerms = ['Bash(*)', ...userPerms.filter((c) => c !== 'Bash(*)')]
    }
  }

  let newRepoUrl = $state('')

  function addRepo() {
    const url = newRepoUrl.trim()
    if (!url) return
    if (repos.some((r) => r.url === url)) return // no duplicates
    repos = [...repos, { name: '', url }]
    newRepoUrl = ''
  }

  function removeRepo(index: number) {
    repos = repos.filter((_, i) => i !== index)
  }

  /** Derive display name from a git URL: org/repo or just repo */
  function deriveRepoName(url: string): string {
    const match = url.match(/[/:]([^/]+)\/([^/]+?)(?:\.git)?$/)
    return match ? match[2] : url.split('/').pop()?.replace(/\.git$/, '') || url
  }

  const editingAgent = $derived(
    $editingAgentId ? $agents.find((a) => a.id === $editingAgentId) : null
  )

  const isEditing = $derived(!!editingAgent)
  const isBaseAgent = $derived($editingAgentId === 'claude')

  // Validation — base agent bypasses name rules since "claude" doesn't end in "er"
  const nameValid = $derived(isBaseAgent || /^[a-z][a-z-]*er$/.test(name.trim()))
  const nameFormatError = $derived.by(() => {
    const n = name.trim()
    if (!n) return ''
    if (/[^a-z-]/.test(n)) return 'Only lowercase letters and hyphens allowed'
    if (!n.endsWith('er')) return 'Name must end in "er"'
    if (n.startsWith('-') || n.endsWith('-') || n.includes('--')) return 'Invalid hyphen placement'
    return ''
  })
  const canSave = $derived(nameValid)

  function handleNameInput(e: Event & { currentTarget: HTMLInputElement }) {
    const filtered = e.currentTarget.value.toLowerCase().replace(/[^a-z-]/g, '')
    name = filtered
    // Sync DOM value in case characters were stripped
    e.currentTarget.value = filtered
  }

  // Populate form when editing
  $effect(() => {
    if (editingAgent) {
      name = editingAgent.name
      emoji = editingAgent.emoji || '🤖'
      description = editingAgent.description
      useWhen = (editingAgent as any).useWhen || ''
      // Extract body (after frontmatter)
      const match = editingAgent.claudeMdContent.match(/^---\n[\s\S]*?\n---\n\n?([\s\S]*)$/)
      claudeMdBody = match ? match[1] : editingAgent.claudeMdContent
      args = [...editingAgent.args]
      mcpRequirements = [...editingAgent.mcpRequirements]
      const all = editingAgent.allowedCommands || []
      packagePerms = all.filter((c) => COMMON_PERMISSIONS.includes(c))
      userPerms = all.filter((c) => !COMMON_PERMISSIONS.includes(c))
      repos = [...(editingAgent.repos || [])]
    } else {
      name = ''
      emoji = '🤖'
      description = ''
      useWhen = ''
      claudeMdBody = ''
      args = []
      mcpRequirements = []
      packagePerms = []
      userPerms = []
      repos = []
      cloneStatus = {}
      cloneError = {}
    }
  })

  function close() {
    showCreateAgentModal.set(false)
    editingAgentId.set(null)
  }

  function addArg() {
    args = [...args, { name: '', description: '', required: false }]
  }

  function removeArg(index: number) {
    args = args.filter((_, i) => i !== index)
  }

  function addMcp() {
    const val = newMcp.trim()
    if (val && !mcpRequirements.includes(val)) {
      mcpRequirements = [...mcpRequirements, val]
      newMcp = ''
    }
  }

  function removeMcp(index: number) {
    mcpRequirements = mcpRequirements.filter((_, i) => i !== index)
  }

  async function handleSave() {
    console.log('[CreateAgent] clicked. canSave:', canSave, 'nameValid:', nameValid, 'name:', JSON.stringify(name), 'claudeMdBody length:', claudeMdBody.trim().length, 'saving:', saving)
    if (!canSave) {
      console.log('[CreateAgent] blocked by canSave=false')
      return
    }
    saving = true
    console.log('[CreateAgent] saving=true, calling API...')

    const input = JSON.parse(JSON.stringify({
      name: name.trim(),
      emoji: emoji.trim() || '🤖',
      description: description.trim(),
      useWhen: useWhen.trim(),
      claudeMdBody: claudeMdBody.trim(),
      args: args.filter((a) => a.name.trim()).map((a) => {
        const cleaned = { ...a }
        if (!cleaned.mcp?.trim()) delete cleaned.mcp
        return cleaned
      }),
      mcpRequirements,
      allowedCommands: [...packagePerms, ...userPerms],
      repos: repos.filter((r) => r.url.trim()).map((r) => ({ name: '', url: r.url.trim() }))
    }))

    console.log('[CreateAgent] input:', JSON.stringify(input, null, 2))

    try {
      if (isEditing && $editingAgentId) {
        console.log('[CreateAgent] updating agent:', $editingAgentId)
        await updateAgent($editingAgentId, input)
      } else {
        console.log('[CreateAgent] creating new agent...')
        await createAgent(input)
      }
      console.log('[CreateAgent] success!')
      close()
    } catch (err) {
      console.error('[CreateAgent] FAILED:', err)
    } finally {
      saving = false
    }
  }

  function autoExpand(e: Event) {
    const el = e.target as HTMLTextAreaElement
    el.style.height = 'auto'
    el.style.height = el.scrollHeight + 'px'
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') close()
  }
</script>

{#if $showCreateAgentModal}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="overlay" onclick={close} onkeydown={handleKeydown}>
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="modal" onclick={(e) => e.stopPropagation()} onkeydown={handleKeydown}>
      <div class="modal-header">
        <h2>{isEditing ? 'Edit Agent' : 'Create Agent'}</h2>
        <button class="close-btn" onclick={close}>x</button>
      </div>

      <div class="form">
        <div class="field">
          <label for="agent-name">Name <span class="required">*</span></label>
          <div class="name-row">
            <input
              class="emoji-input"
              type="text"
              bind:value={emoji}
              maxlength="2"
              title="Agent emoji icon"
            />
            <input
              id="agent-name"
              type="text"
              value={name}
              oninput={handleNameInput}
              placeholder="e.g. pr-reviewer"
              class:invalid={name.trim() && !nameValid}
              disabled={isBaseAgent}
            />
          </div>
          {#if name.trim() && nameFormatError}
            <span class="field-error">{nameFormatError}</span>
          {/if}
          {#if name.trim() && !nameFormatError && nameValid}
            <span class="field-hint">Agent ID: {name.trim()}</span>
          {/if}
        </div>

        <div class="field">
          <label for="agent-desc">Description</label>
          <textarea
            id="agent-desc"
            bind:value={description}
            oninput={autoExpand}
            placeholder="What does this agent do?"
            rows="1"
            class="auto-expand"
          ></textarea>
        </div>

        <div class="field">
          <label for="agent-use-when">Use when</label>
          <textarea
            id="agent-use-when"
            bind:value={useWhen}
            oninput={autoExpand}
            placeholder="e.g. A PR needs reviewing, A Sentry error needs debugging, A new feature branch needs to be merged..."
            rows="1"
            class="auto-expand"
          ></textarea>
          <span class="field-hint-muted">Describe the conditions when this agent should be triggered</span>
        </div>

        <div class="field">
          <label for="agent-claude-md">CLAUDE.md Instructions</label>
          <textarea
            id="agent-claude-md"
            bind:value={claudeMdBody}
            placeholder="# Agent Name&#10;&#10;## Purpose&#10;...&#10;&#10;## Workflow&#10;..."
            rows="12"
          ></textarea>
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
                <input type="text" bind:value={arg.mcp} placeholder="MCP" class="arg-field-mcp" title="MCP required when this arg is filled" />
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
            <h3>Repos</h3>
          </div>
          <p class="section-desc">GitHub repositories to clone into the agent's workspace</p>
          <div class="repo-input-row">
            <input
              type="text"
              bind:value={newRepoUrl}
              placeholder="https://github.com/org/repo.git"
              onkeydown={(e) => e.key === 'Enter' && addRepo()}
            />
            <button class="add-btn" onclick={addRepo}>+ Add</button>
          </div>
          {#if repos.length > 0}
            <div class="repo-tags">
              {#each repos as repo, i}
                <span class="repo-tag">
                  <span class="repo-tag-name">{deriveRepoName(repo.url)}</span>
                  <span class="repo-tag-url">{repo.url}</span>
                  <button class="tag-remove" onclick={() => removeRepo(i)}>x</button>
                </span>
              {/each}
            </div>
            <span class="field-hint-muted">Repos will be cloned on agent creation (may take a moment)</span>
          {/if}
        </div>

        <div class="section">
          <div class="section-header">
            <h3>MCP Requirements</h3>
          </div>
          <div class="mcp-input-row">
            <input
              type="text"
              bind:value={newMcp}
              placeholder="e.g. Linear, Slack..."
              onkeydown={(e) => e.key === 'Enter' && addMcp()}
            />
            <button class="add-btn" onclick={addMcp}>+ Add</button>
          </div>
          {#if mcpRequirements.length > 0}
            <div class="mcp-tags">
              {#each mcpRequirements as mcp, i}
                <span class="mcp-tag">
                  {mcp}
                  <button class="tag-remove" onclick={() => removeMcp(i)}>x</button>
                </span>
              {/each}
            </div>
          {/if}
        </div>

        <div class="section">
          <div class="section-header">
            <h3>Package Permissions</h3>
          </div>
          <p class="section-desc">Predefined commands — toggle to whitelist</p>
          <div class="perm-grid">
            {#each COMMON_PERMISSIONS as perm}
              <label class="perm-option">
                <input
                  type="checkbox"
                  checked={packagePerms.includes(perm)}
                  onchange={() => togglePackagePerm(perm)}
                />
                <span class="perm-label">{perm}</span>
              </label>
            {/each}
          </div>
        </div>

        <div class="section">
          <div class="section-header">
            <h3>User Permissions</h3>
            <label class="allow-all-toggle">
              <input type="checkbox" checked={allowAll} onchange={toggleAllowAll} />
              Allow All <span class="allow-all-hint">Bash(*)</span>
            </label>
          </div>
          <div class="mcp-input-row">
            <input
              type="text"
              bind:value={newCommand}
              placeholder="e.g. Bash(cd * && git checkout:*)"
              onkeydown={(e) => e.key === 'Enter' && addCommand()}
            />
            <button class="add-btn" onclick={addCommand}>+ Add</button>
          </div>
          {#if userPerms.length > 0}
            <div class="mcp-tags" style="margin-top: 6px">
              {#each userPerms as cmd, i}
                <span class="mcp-tag">
                  {cmd}
                  <button class="tag-remove" onclick={() => removeUserPerm(i)}>x</button>
                </span>
              {/each}
            </div>
          {/if}
        </div>
      </div>

      {#if saving && repos.length > 0}
        <div class="progress-section">
          <h3>Setting up agent...</h3>
          {#each repos as repo}
            {@const rName = deriveRepoName(repo.url)}
            <div class="progress-row">
              <span class="progress-icon">
                {#if cloneStatus[rName] === 'done'}
                  <span class="icon-done">✓</span>
                {:else if cloneStatus[rName] === 'error'}
                  <span class="icon-error">✗</span>
                {:else if cloneStatus[rName] === 'cloning'}
                  <span class="icon-cloning">↻</span>
                {:else}
                  <span class="icon-pending">○</span>
                {/if}
              </span>
              <span class="progress-label">
                {rName}
                {#if cloneStatus[rName] === 'cloning'}
                  — cloning...
                {:else if cloneStatus[rName] === 'done'}
                  — done
                {:else if cloneStatus[rName] === 'error'}
                  — failed: {cloneError[rName] || 'unknown error'}
                {:else}
                  — waiting
                {/if}
              </span>
            </div>
          {/each}
        </div>
      {/if}

      <div class="modal-footer">
        {#if !canSave && name.trim()}
          <span class="footer-hint">
            {#if !nameValid}
              Name must be lowercase, hyphens only, ending in "er"
            {/if}
          </span>
        {/if}
        <button class="cancel-btn" onclick={close} disabled={saving}>Cancel</button>
        <button
          class="save-btn"
          onclick={handleSave}
          disabled={saving || !canSave}
        >
          {saving ? 'Creating...' : isEditing ? 'Update' : 'Create'}
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
    width: 600px;
    max-width: calc(100vw - 40px);
    max-height: 85vh;
    overflow-y: auto;
    overflow-x: hidden;
    padding: 24px;
    box-sizing: border-box;
  }

  .modal-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 16px;
  }

  .modal-header h2 {
    font-size: 18px;
    font-weight: 600;
    color: #cdd6f4;
    margin: 0;
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

  .form {
    display: flex;
    flex-direction: column;
    gap: 14px;
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .field label {
    font-size: 12px;
    font-weight: 500;
    color: #a6adc8;
  }

  .name-row {
    display: flex;
    gap: 6px;
  }

  .name-row input[id="agent-name"] {
    flex: 1;
  }

  .emoji-input {
    width: 42px;
    text-align: center;
    font-size: 18px;
    padding: 4px 6px !important;
    background: #11111b;
    border: 1px solid #313244;
    border-radius: 6px;
    color: #cdd6f4;
    outline: none;
    flex-shrink: 0;
    cursor: text;
  }

  .emoji-input:focus {
    border-color: #89b4fa;
  }

  .required {
    color: #f38ba8;
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

  .field input:focus, .field textarea:focus {
    border-color: #89b4fa;
  }

  .field input.invalid {
    border-color: #f38ba8;
  }

  .field-error {
    font-size: 11px;
    color: #f38ba8;
  }

  .field-hint {
    font-size: 11px;
    color: #a6e3a1;
  }

  .field-hint-muted {
    font-size: 11px;
    color: #585b70;
  }

  .section-desc {
    font-size: 11px;
    color: #585b70;
    margin: 0 0 8px;
  }

  .repo-input-row {
    display: flex;
    gap: 6px;
    margin-bottom: 8px;
  }

  .repo-input-row input {
    flex: 1;
    background: #11111b;
    border: 1px solid #313244;
    border-radius: 4px;
    padding: 5px 8px;
    color: #cdd6f4;
    font-size: 12px;
    font-family: 'SF Mono', 'Menlo', monospace;
    outline: none;
  }

  .repo-input-row input:focus {
    border-color: #89b4fa;
  }

  .repo-tags {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin-bottom: 6px;
  }

  .repo-tag {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 10px;
    background: #11111b;
    border: 1px solid #313244;
    border-radius: 6px;
  }

  .repo-tag-name {
    font-size: 13px;
    font-weight: 500;
    color: #cdd6f4;
    flex-shrink: 0;
  }

  .repo-tag-url {
    font-size: 10px;
    color: #585b70;
    font-family: 'SF Mono', 'Menlo', monospace;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex: 1;
  }

  .perm-grid {
    display: grid;
    grid-template-columns: 1fr 1fr 1fr;
    gap: 4px;
  }

  .perm-option {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 5px 8px;
    border-radius: 4px;
    cursor: pointer;
    font-size: 12px;
    color: #a6adc8;
  }

  .perm-option:hover {
    background: #11111b;
  }

  .perm-option input {
    margin: 0;
    accent-color: #a6e3a1;
  }

  .perm-label {
    font-family: 'SF Mono', 'Menlo', monospace;
    font-size: 11px;
  }

  .allow-all-toggle {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    color: #a6adc8;
    cursor: pointer;
  }

  .allow-all-toggle input {
    margin: 0;
    accent-color: #f38ba8;
  }

  .allow-all-hint {
    font-family: 'SF Mono', 'Menlo', monospace;
    font-size: 10px;
    color: #585b70;
  }

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
    color: #89b4fa;
    font-size: 11px;
    cursor: pointer;
  }

  .add-btn:hover {
    background: #45475a;
  }

  .arg-block {
    margin-bottom: 8px;
    padding: 8px 10px;
    background: #11111b;
    border: 1px solid #313244;
    border-radius: 6px;
  }

  .arg-row-top {
    display: flex;
    gap: 6px;
    align-items: center;
    margin-bottom: 6px;
  }

  .arg-name {
    width: 120px;
    flex-shrink: 0;
    background: #181825;
    border: 1px solid #313244;
    border-radius: 4px;
    padding: 5px 8px;
    color: #cdd6f4;
    font-size: 12px;
    font-weight: 500;
    outline: none;
  }

  .arg-name:focus {
    border-color: #89b4fa;
  }

  .arg-desc {
    flex: 1;
    min-width: 0;
    background: #181825;
    border: 1px solid #313244;
    border-radius: 4px;
    padding: 5px 8px;
    color: #a6adc8;
    font-size: 12px;
    outline: none;
  }

  .arg-desc:focus {
    border-color: #89b4fa;
  }

  .arg-row-bottom {
    display: flex;
    gap: 6px;
    align-items: center;
  }

  .arg-field-sm {
    background: #181825;
    border: 1px solid #313244;
    border-radius: 4px;
    padding: 4px 8px;
    color: #cdd6f4;
    font-size: 11px;
    outline: none;
    min-width: 0;
    width: 80px;
  }

  .arg-field-sm:focus {
    border-color: #89b4fa;
  }

  .arg-field-mcp {
    width: 70px;
    flex-shrink: 0;
    background: #181825;
    border: 1px solid #313244;
    border-radius: 4px;
    padding: 4px 8px;
    color: #cba6f7;
    font-size: 11px;
    outline: none;
  }

  .arg-field-mcp:focus {
    border-color: #cba6f7;
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

  .arg-required input {
    margin: 0;
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

  .remove-btn:hover {
    color: #f38ba8;
    background: #313244;
  }

  .mcp-input-row {
    display: flex;
    gap: 6px;
    margin-bottom: 8px;
  }

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

  .mcp-input-row input:focus {
    border-color: #89b4fa;
  }

  .mcp-tags {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
  }

  .mcp-tag {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 12px;
    padding: 3px 8px;
    border-radius: 6px;
    background: #313244;
    color: #cba6f7;
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

  .tag-remove:hover {
    color: #f38ba8;
  }

  .modal-footer {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 20px;
  }

  .progress-section {
    margin-top: 16px;
    padding: 12px;
    background: #11111b;
    border: 1px solid #313244;
    border-radius: 8px;
  }

  .progress-section h3 {
    font-size: 12px;
    font-weight: 600;
    color: #a6adc8;
    margin: 0 0 10px;
  }

  .progress-row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 0;
    font-size: 13px;
    color: #cdd6f4;
  }

  .progress-icon {
    width: 18px;
    text-align: center;
    font-size: 14px;
  }

  .icon-done {
    color: #a6e3a1;
  }

  .icon-error {
    color: #f38ba8;
  }

  .icon-cloning {
    color: #89b4fa;
    display: inline-block;
    animation: spin 1s linear infinite;
  }

  .icon-pending {
    color: #585b70;
  }

  .progress-label {
    font-size: 12px;
  }

  @keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }

  .footer-hint {
    font-size: 11px;
    color: #f38ba8;
    margin-right: auto;
    align-self: center;
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

  .save-btn {
    padding: 8px 20px;
    border-radius: 8px;
    border: none;
    background: #a6e3a1;
    color: #1e1e2e;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
  }

  .save-btn:hover:not(:disabled) {
    background: #94e2d5;
  }

  .save-btn:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
</style>
