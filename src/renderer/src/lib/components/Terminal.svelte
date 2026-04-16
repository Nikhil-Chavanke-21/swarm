<script lang="ts">
  import { onMount, onDestroy } from 'svelte'
  import { Terminal } from '@xterm/xterm'
  import { FitAddon } from '@xterm/addon-fit'

  let { instanceId }: { instanceId: string } = $props()

  let containerEl: HTMLDivElement
  let terminal: Terminal
  let fitAddon: FitAddon
  let cleanupData: (() => void) | null = null
  let cleanupExit: (() => void) | null = null

  onMount(() => {
    terminal = new Terminal({
      theme: {
        background: '#1e1e2e',
        foreground: '#cdd6f4',
        cursor: '#f5e0dc',
        selectionBackground: '#45475a',
        black: '#45475a',
        red: '#f38ba8',
        green: '#a6e3a1',
        yellow: '#f9e2af',
        blue: '#89b4fa',
        magenta: '#cba6f7',
        cyan: '#94e2d5',
        white: '#bac2de',
        brightBlack: '#585b70',
        brightRed: '#f38ba8',
        brightGreen: '#a6e3a1',
        brightYellow: '#f9e2af',
        brightBlue: '#89b4fa',
        brightMagenta: '#cba6f7',
        brightCyan: '#94e2d5',
        brightWhite: '#a6adc8'
      },
      fontFamily: "'SF Mono', 'Menlo', 'Monaco', 'Courier New', monospace",
      fontSize: 13,
      lineHeight: 1.4,
      cursorBlink: true,
      scrollback: 10000
    })

    fitAddon = new FitAddon()
    terminal.loadAddon(fitAddon)
    terminal.open(containerEl)

    // Delay fit to ensure container is rendered — double rAF for layout settle
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        fitAddon.fit()
        window.api.ptyResize(instanceId, terminal.cols, terminal.rows)
      })
    })

    // Forward user input to PTY
    terminal.onData((data) => {
      window.api.ptyWrite(instanceId, data)
    })

    // Receive PTY output
    cleanupData = window.api.onPtyData(({ instanceId: id, data }) => {
      if (id === instanceId) {
        terminal.write(data)
      }
    })

    cleanupExit = window.api.onPtyExit(({ instanceId: id, exitCode }) => {
      if (id === instanceId) {
        terminal.write(`\r\n\x1b[90m[Process exited with code ${exitCode}]\x1b[0m\r\n`)
      }
    })

    // Handle window resize
    const resizeObserver = new ResizeObserver(() => {
      fitAddon.fit()
      window.api.ptyResize(instanceId, terminal.cols, terminal.rows)
    })
    resizeObserver.observe(containerEl)

    return () => {
      resizeObserver.disconnect()
    }
  })

  onDestroy(() => {
    cleanupData?.()
    cleanupExit?.()
    terminal?.dispose()
  })
</script>

<div class="terminal-container" bind:this={containerEl}></div>

<style>
  .terminal-container {
    width: 100%;
    height: 100%;
    background: #1e1e2e;
  }

  .terminal-container :global(.xterm) {
    padding: 4px;
    height: 100%;
  }

  .terminal-container :global(.xterm-viewport) {
    overflow-y: auto !important;
  }
</style>
