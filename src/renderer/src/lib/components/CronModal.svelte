<script lang="ts">
  import type { AgentDefinition, CronDefinition, CronSchedule, AgentArg } from '../types'
  import { onMount } from 'svelte'

  let {
    agent,
    visible = $bindable(false)
  }: {
    agent: AgentDefinition
    visible: boolean
  } = $props()

  let crons = $state<CronDefinition[]>([])
  let loading = $state(true)

  // New cron form
  let newLabel = $state('')
  let newHour = $state<string>('')
  let newMinute = $state<string>('0')
  let newWeekday = $state<string>('')  // empty = every day
  let newArgs = $state<Record<string, string>>({})
  let adding = $state(false)

  const WEEKDAYS = [
    { value: '', label: 'Every day' },
    { value: '1', label: 'Monday' },
    { value: '2', label: 'Tuesday' },
    { value: '3', label: 'Wednesday' },
    { value: '4', label: 'Thursday' },
    { value: '5', label: 'Friday' },
    { value: '6', label: 'Saturday' },
    { value: '0', label: 'Sunday' }
  ]

  async function loadCrons() {
    loading = true
    try {
      crons = await window.api.cronList(agent.id)
    } catch (err) {
      console.error('Failed to load crons:', err)
      crons = []
    }
    loading = false
  }

  $effect(() => {
    if (visible && agent) {
      loadCrons()
      // Initialize arg defaults
      newArgs = {}
      for (const arg of agent.args) {
        if (arg.default) newArgs[arg.name] = arg.default
      }
    }
  })

  function buildSchedule(): CronSchedule {
    const schedule: CronSchedule = {}
    if (newMinute !== '') schedule.minute = parseInt(newMinute)
    if (newHour !== '') schedule.hour = parseInt(newHour)
    if (newWeekday !== '') schedule.weekday = parseInt(newWeekday)
    return schedule
  }

  function formatSchedule(schedule: CronSchedule): string {
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
    const parts: string[] = []
    if (schedule.weekday !== undefined) parts.push(days[schedule.weekday])
    if (schedule.hour !== undefined && schedule.minute !== undefined) {
      parts.push(`${String(schedule.hour).padStart(2, '0')}:${String(schedule.minute).padStart(2, '0')}`)
    } else if (schedule.hour !== undefined) {
      parts.push(`${String(schedule.hour).padStart(2, '0')}:00`)
    } else if (schedule.minute !== undefined) {
      parts.push(`every hour at :${String(schedule.minute).padStart(2, '0')}`)
    }
    return parts.join(' ') || 'every minute'
  }

  function formatArgs(args: Record<string, string>): string {
    const entries = Object.entries(args).filter(([, v]) => v)
    if (entries.length === 0) return 'no args'
    return entries.map(([k, v]) => `${k}: ${v}`).join(', ')
  }

  async function handleAdd() {
    if (!newLabel.trim()) return
    adding = true
    try {
      const schedule = buildSchedule()
      const filteredArgs: Record<string, string> = {}
      for (const [k, v] of Object.entries(newArgs)) {
        if (v.trim()) filteredArgs[k] = v.trim()
      }
      await window.api.cronAdd(agent.id, newLabel.trim(), schedule, filteredArgs)
      newLabel = ''
      newHour = ''
      newMinute = '0'
      newWeekday = ''
      newArgs = {}
      for (const arg of agent.args) {
        if (arg.default) newArgs[arg.name] = arg.default
      }
      await loadCrons()
    } catch (err) {
      console.error('Failed to add cron:', err)
    }
    adding = false
  }

  async function handleToggle(cron: CronDefinition) {
    await window.api.cronUpdate(agent.id, cron.id, { enabled: !cron.enabled })
    await loadCrons()
  }

  async function handleDelete(cronId: string) {
    await window.api.cronDelete(agent.id, cronId)
    await loadCrons()
  }

  function close() {
    visible = false
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') close()
  }
</script>

{#if visible}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="overlay" onclick={close} onkeydown={handleKeydown}>
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="modal" onclick={(e) => e.stopPropagation()} onkeydown={handleKeydown}>
      <div class="modal-header">
        <h2>{agent.emoji} {agent.name} — Scheduled Jobs</h2>
        <button class="close-btn" onclick={close}>x</button>
      </div>

      <!-- Existing crons -->
      <div class="cron-list">
        {#if loading}
          <div class="empty">Loading...</div>
        {:else if crons.length === 0}
          <div class="empty">No scheduled jobs yet.</div>
        {:else}
          {#each crons as cron (cron.id)}
            <div class="cron-card" class:disabled={!cron.enabled}>
              <div class="cron-row">
                <button
                  class="toggle-btn"
                  class:on={cron.enabled}
                  onclick={() => handleToggle(cron)}
                  title={cron.enabled ? 'Disable' : 'Enable'}
                >{cron.enabled ? 'ON' : 'OFF'}</button>
                <div class="cron-info">
                  <span class="cron-label">{cron.label}</span>
                  <span class="cron-schedule">{formatSchedule(cron.schedule)}</span>
                </div>
                <span class="cron-args">{formatArgs(cron.args)}</span>
                <button class="del-btn" onclick={() => handleDelete(cron.id)} title="Delete">x</button>
              </div>
            </div>
          {/each}
        {/if}
      </div>

      <!-- Add new cron -->
      <div class="add-section">
        <h3>Add Scheduled Job</h3>

        <div class="field">
          <label>Label</label>
          <input type="text" bind:value={newLabel} placeholder="e.g. Daily PR review" />
        </div>

        <div class="schedule-row">
          <div class="field narrow">
            <label>Day</label>
            <select bind:value={newWeekday}>
              {#each WEEKDAYS as wd}
                <option value={wd.value}>{wd.label}</option>
              {/each}
            </select>
          </div>
          <div class="field narrow">
            <label>Hour</label>
            <input type="number" bind:value={newHour} placeholder="*" min="0" max="23" />
          </div>
          <div class="field narrow">
            <label>Minute</label>
            <input type="number" bind:value={newMinute} placeholder="0" min="0" max="59" />
          </div>
        </div>

        <div class="schedule-hint">
          Preview: {formatSchedule(buildSchedule())}
        </div>

        {#if agent.args.length > 0}
          <div class="args-section">
            <label>Arguments</label>
            {#each agent.args as arg}
              <div class="arg-row">
                <span class="arg-label">{arg.name}{arg.required ? ' *' : ''}</span>
                {#if arg.options && arg.options.length > 0}
                  <select
                    value={newArgs[arg.name] ?? arg.default ?? ''}
                    onchange={(e) => { newArgs[arg.name] = e.currentTarget.value }}
                  >
                    {#if !arg.required}
                      <option value="">—</option>
                    {/if}
                    {#each arg.options as opt}
                      <option value={opt}>{opt}</option>
                    {/each}
                  </select>
                {:else}
                  <input
                    type="text"
                    value={newArgs[arg.name] ?? arg.default ?? ''}
                    oninput={(e) => { newArgs[arg.name] = e.currentTarget.value }}
                    placeholder={arg.description}
                  />
                {/if}
              </div>
            {/each}
          </div>
        {/if}

        <button class="add-btn" onclick={handleAdd} disabled={adding || !newLabel.trim()}>
          {adding ? 'Adding...' : '+ Add Job'}
        </button>
      </div>

      <div class="modal-footer">
        <span class="footer-hint">Jobs run via macOS launchd on instance #1. Skips if a session is already running.</span>
        <button class="done-btn" onclick={close}>Done</button>
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
    width: 560px;
    max-height: 85vh;
    overflow-y: auto;
    padding: 24px;
  }

  .modal-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 16px;
  }

  .modal-header h2 {
    font-size: 16px;
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

  .cron-list {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin-bottom: 20px;
  }

  .empty {
    font-size: 13px;
    color: #585b70;
    text-align: center;
    padding: 16px;
  }

  .cron-card {
    background: #181825;
    border: 1px solid #313244;
    border-radius: 8px;
    padding: 10px 12px;
  }

  .cron-card.disabled {
    opacity: 0.5;
  }

  .cron-row {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .toggle-btn {
    font-size: 10px;
    font-weight: 700;
    padding: 3px 8px;
    border-radius: 4px;
    border: 1px solid #313244;
    background: #11111b;
    color: #585b70;
    cursor: pointer;
    flex-shrink: 0;
  }

  .toggle-btn.on {
    color: #a6e3a1;
    border-color: #a6e3a1;
    background: color-mix(in srgb, #a6e3a1 10%, #11111b);
  }

  .cron-info {
    display: flex;
    flex-direction: column;
    gap: 2px;
    flex: 1;
    min-width: 0;
  }

  .cron-label {
    font-size: 13px;
    font-weight: 500;
    color: #cdd6f4;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .cron-schedule {
    font-size: 11px;
    color: #89b4fa;
    font-family: 'SF Mono', 'Menlo', monospace;
  }

  .cron-args {
    font-size: 11px;
    color: #585b70;
    flex-shrink: 0;
    max-width: 160px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .del-btn {
    background: none;
    border: none;
    color: #585b70;
    cursor: pointer;
    font-size: 14px;
    padding: 2px 6px;
    border-radius: 4px;
    flex-shrink: 0;
  }

  .del-btn:hover {
    color: #f38ba8;
    background: #313244;
  }

  .add-section {
    border-top: 1px solid #313244;
    padding-top: 16px;
  }

  .add-section h3 {
    font-size: 12px;
    font-weight: 600;
    color: #a6adc8;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin: 0 0 12px;
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin-bottom: 10px;
  }

  .field label {
    font-size: 11px;
    font-weight: 500;
    color: #a6adc8;
  }

  .field input, .field select {
    background: #11111b;
    border: 1px solid #313244;
    border-radius: 6px;
    padding: 7px 10px;
    color: #cdd6f4;
    font-size: 13px;
    outline: none;
  }

  .field input:focus, .field select:focus {
    border-color: #89b4fa;
  }

  .field select {
    cursor: pointer;
  }

  .schedule-row {
    display: flex;
    gap: 10px;
  }

  .narrow {
    flex: 1;
  }

  .narrow input {
    width: 100%;
  }

  .schedule-hint {
    font-size: 11px;
    color: #89b4fa;
    margin-bottom: 12px;
    font-family: 'SF Mono', 'Menlo', monospace;
  }

  .args-section {
    margin-bottom: 12px;
  }

  .args-section > label {
    font-size: 11px;
    font-weight: 500;
    color: #a6adc8;
    display: block;
    margin-bottom: 6px;
  }

  .arg-row {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 6px;
  }

  .arg-label {
    font-size: 12px;
    color: #a6adc8;
    width: 100px;
    flex-shrink: 0;
  }

  .arg-row input, .arg-row select {
    flex: 1;
    background: #11111b;
    border: 1px solid #313244;
    border-radius: 4px;
    padding: 5px 8px;
    color: #cdd6f4;
    font-size: 12px;
    outline: none;
  }

  .arg-row input:focus, .arg-row select:focus {
    border-color: #89b4fa;
  }

  .add-btn {
    width: 100%;
    padding: 8px;
    border-radius: 8px;
    border: 1px dashed #45475a;
    background: transparent;
    color: #a6e3a1;
    font-size: 13px;
    cursor: pointer;
  }

  .add-btn:hover:not(:disabled) {
    background: #181825;
    border-color: #a6e3a1;
  }

  .add-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .modal-footer {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-top: 20px;
    gap: 12px;
  }

  .footer-hint {
    font-size: 10px;
    color: #585b70;
    flex: 1;
  }

  .done-btn {
    padding: 8px 20px;
    border-radius: 8px;
    border: none;
    background: #89b4fa;
    color: #1e1e2e;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    flex-shrink: 0;
  }

  .done-btn:hover {
    background: #74c7ec;
  }
</style>
