<script lang="ts">
  import { onMount, onDestroy } from 'svelte'
  import { Terminal } from '@xterm/xterm'
  import { FitAddon } from '@xterm/addon-fit'
  import { resumeSession } from '../stores/sessions'
  import type { SessionRecord } from '../types'

  let { record }: { record: SessionRecord } = $props()

  let resuming = $state(false)

  async function handleResume() {
    if (!record.claudeSessionId || resuming) return
    resuming = true
    try {
      await resumeSession(record.agentId, record.instanceId, record.claudeSessionId)
    } finally {
      resuming = false
    }
  }

  let containerEl: HTMLDivElement
  let terminal: Terminal
  let fitAddon: FitAddon

  function formatDuration(ms?: number): string {
    if (!ms) return '—'
    const s = Math.floor(ms / 1000)
    if (s < 60) return `${s}s`
    const m = Math.floor(s / 60)
    const rem = s % 60
    return `${m}m ${rem}s`
  }

  function formatDate(iso: string): string {
    return new Date(iso).toLocaleString()
  }

  onMount(async () => {
    terminal = new Terminal({
      theme: {
        background: '#11111b',
        foreground: '#cdd6f4',
        selectionBackground: '#45475a',
        black: '#45475a', red: '#f38ba8', green: '#a6e3a1',
        yellow: '#f9e2af', blue: '#89b4fa', magenta: '#cba6f7',
        cyan: '#94e2d5', white: '#bac2de',
        brightBlack: '#585b70', brightRed: '#f38ba8', brightGreen: '#a6e3a1',
        brightYellow: '#f9e2af', brightBlue: '#89b4fa', brightMagenta: '#cba6f7',
        brightCyan: '#94e2d5', brightWhite: '#a6adc8'
      },
      fontFamily: "'SF Mono', 'Menlo', 'Monaco', 'Courier New', monospace",
      fontSize: 13,
      lineHeight: 1.4,
      cursorBlink: false,
      scrollback: 50000,
      disableStdin: true
    })

    fitAddon = new FitAddon()
    terminal.loadAddon(fitAddon)
    terminal.open(containerEl)

    requestAnimationFrame(() => {
      requestAnimationFrame(() => fitAddon.fit())
    })

    const resizeObserver = new ResizeObserver(() => fitAddon.fit())
    resizeObserver.observe(containerEl)

    const raw = await window.api.sessionsReadLog(record.id, record.logDir)
    if (raw) terminal.write(raw)

    return () => resizeObserver.disconnect()
  })

  onDestroy(() => {
    terminal?.dispose()
  })
</script>

<div class="viewer">
  <div class="viewer-header">
    <div class="meta">
      <span class="agent-name">{record.agentName}</span>
      <span class="sep">·</span>
      <span class="inst">Instance {record.instanceIndex}{record.instanceTag ? ` · ${record.instanceTag}` : ''}</span>
      <span class="sep">·</span>
      <span class="date">{formatDate(record.startedAt)}</span>
      {#if record.durationMs}
        <span class="sep">·</span>
        <span class="duration">{formatDuration(record.durationMs)}</span>
      {/if}
      {#if record.claudeSessionId}
        <button class="resume-btn" onclick={handleResume} disabled={resuming}>
          {resuming ? 'Resuming…' : '↩ Resume'}
        </button>
      {/if}
    </div>
    {#if record.prompt}
      <div class="prompt-preview">{record.prompt}</div>
    {/if}
  </div>
  <div class="terminal-container" bind:this={containerEl}></div>
</div>

<style>
  .viewer {
    display: flex;
    flex-direction: column;
    height: 100%;
    background: #11111b;
  }

  .viewer-header {
    padding: 8px 12px;
    background: #181825;
    border-bottom: 1px solid #313244;
    display: flex;
    flex-direction: column;
    gap: 4px;
    flex-shrink: 0;
  }

  .meta {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
  }

  .agent-name {
    font-size: 13px;
    font-weight: 600;
    color: #cdd6f4;
  }

  .inst {
    font-size: 12px;
    color: #a6adc8;
  }

  .sep {
    color: #45475a;
    font-size: 12px;
  }

  .date {
    font-size: 11px;
    color: #6c7086;
  }

  .duration {
    font-size: 11px;
    color: #6c7086;
    font-family: monospace;
  }

  .prompt-preview {
    font-size: 11px;
    color: #585b70;
    font-family: monospace;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .resume-btn {
    margin-left: auto;
    padding: 4px 12px;
    border-radius: 4px;
    border: 1px solid #f9e2af44;
    background: #f9e2af11;
    color: #f9e2af;
    font-size: 12px;
    cursor: pointer;
    white-space: nowrap;
    flex-shrink: 0;
  }

  .resume-btn:hover:not(:disabled) {
    background: #f9e2af22;
    border-color: #f9e2af88;
  }

  .resume-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .terminal-container {
    flex: 1;
    overflow: hidden;
  }

  .terminal-container :global(.xterm) {
    padding: 4px;
    height: 100%;
  }

  .terminal-container :global(.xterm-viewport) {
    overflow-y: auto !important;
  }
</style>
