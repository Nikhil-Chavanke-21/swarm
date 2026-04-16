<script lang="ts">
  import type { McpStatus } from '../types'
  let { name, status }: { name: string; status: McpStatus } = $props()

  const label = $derived(
    status === 'connected' ? '✓' :
    status === 'needs-auth' ? '⚠' : '✕'
  )

  const tip = $derived(
    status === 'connected' ? `${name}: connected` :
    status === 'needs-auth' ? `${name}: needs re-authentication` :
    `${name}: not connected`
  )
</script>

<span class="mcp-badge {status}" title={tip}>
  {label} {name}
</span>

<style>
  .mcp-badge {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 11px;
    padding: 2px 8px;
    border-radius: 4px;
    font-weight: 500;
  }

  .connected {
    background: #a6e3a122;
    border: 1px solid #a6e3a144;
    color: #a6e3a1;
  }

  .needs-auth {
    background: #f9e2af22;
    border: 1px solid #f9e2af44;
    color: #f9e2af;
  }

  .never-connected {
    background: #f38ba822;
    border: 1px solid #f38ba844;
    color: #f38ba8;
  }
</style>
